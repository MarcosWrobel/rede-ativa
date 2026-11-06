"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ShieldAlert,
  Building2,
  GraduationCap,
  Landmark,
  Users,
  Send,
  Plus,
  ArrowRight,
  Search,
  ExternalLink,
  CheckCircle2,
  Clock,
  Sparkles,
  RefreshCw,
  Activity,
  Layers,
  Trash2,
  Eraser,
  Lock,
} from "lucide-react";

interface AdminClientProps {
  metrics: {
    totalNetworks: number;
    totalSchools: number;
    totalStudents: number;
    totalMessages: number;
  };
  networks: Array<{
    id: string;
    name: string;
    shortName: string;
    city: string;
    state: string;
    type: string;
    edition?: string;
    schoolsCount: number;
    managersCount: number;
  }>;
  schools: Array<{
    id: string;
    name: string;
    inepCode: string;
    city: string;
    network: string;
    edition?: string;
    networkName?: string | null;
    studentsCount: number;
    classesCount: number;
    logoUrl?: string | null;
  }>;
  auditLogs: Array<{
    id: string;
    action: string;
    userName: string;
    createdAt: string;
    details?: any;
  }>;
  currentUser: {
    name: string;
    email: string;
  };
}

export default function AdminClient({
  metrics,
  networks,
  schools,
  auditLogs,
  currentUser,
}: AdminClientProps) {
  const [search, setSearch] = useState("");
  const [schoolList, setSchoolList] = useState(schools);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sanitizingId, setSanitizingId] = useState<string | null>(null);

  const filteredSchools = schoolList.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.city.toLowerCase().includes(search.toLowerCase()) ||
      s.inepCode.includes(search)
  );

  const handleDeleteSchool = async (school: (typeof schools)[0]) => {
    if (school.inepCode === "41042730" || school.id === "default-leopoldina") {
      alert("A Unidade Piloto Fundadora (INEP 41042730) é a escola sede da plataforma e não pode ser excluída.");
      return;
    }

    const confirmed = window.confirm(
      `⚠️ ATENÇÃO: Tem certeza absoluta que deseja EXCLUIR DEFINITIVAMENTE a instituição "${school.name}"?\n\nTodos os alunos, turmas, atas e vínculos associados a esta escola serão apagados permanentemente do banco de dados.`
    );
    if (!confirmed) return;

    setDeletingId(school.id);
    try {
      const res = await fetch(`/api/schools/${school.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao excluir escola.");
      }
      setSchoolList((prev) => prev.filter((s) => s.id !== school.id));
      alert(data.message || "Escola excluída com sucesso.");
    } catch (err: any) {
      alert(err.message || "Falha ao excluir instituição.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleSanitizeSchool = async (school: (typeof schools)[0]) => {
    const confirmed = window.confirm(
      `🧹 HIGIENIZAÇÃO DE BANCO: Deseja limpar todos os dados operacionais da escola "${school.name}"?\n\nIsso apagará todos os estudantes, turmas, histórico de mensagens e atas desta escola, retornando a unidade ao estado inicial zerado (0 alunos, 0 turmas).\n\nA instituição em si e seus modelos de mensagem serão preservados.`
    );
    if (!confirmed) return;

    setSanitizingId(school.id);
    try {
      const res = await fetch(`/api/schools/${school.id}/sanitize`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao higienizar escola.");
      }
      setSchoolList((prev) =>
        prev.map((s) => (s.id === school.id ? { ...s, studentsCount: 0, classesCount: 0 } : s))
      );
      alert(data.message || "Escola higienizada com sucesso.");
    } catch (err: any) {
      alert(err.message || "Falha ao higienizar dados da escola.");
    } finally {
      setSanitizingId(null);
    }
  };

  const handleAccessSchool = async (schoolId: string) => {
    setSwitchingId(schoolId);
    try {
      const res = await fetch("/api/auth/switch-school", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId }),
      });
      if (res.ok) {
        window.location.href = "/gestao";
      } else {
        alert("Erro ao alternar para a instituição");
        setSwitchingId(null);
      }
    } catch {
      alert("Falha de conexão ao alternar de escola");
      setSwitchingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* SuperAdmin Header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 rounded-2xl p-6 sm:p-8 text-white border border-slate-800 shadow-xl">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start space-x-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center p-2 backdrop-blur-md flex-shrink-0">
              <ShieldAlert className="w-7 h-7 text-indigo-400" />
            </div>
            <div>
              <div className="inline-flex items-center space-x-2 bg-indigo-500/20 px-3 py-1 rounded-full text-xs font-semibold backdrop-blur-xs mb-2 border border-indigo-400/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Super Admin • Gestão Operacional do SaaS</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
                Painel Global da Plataforma
              </h1>
              <p className="text-slate-300 text-sm mt-1 max-w-xl">
                Controle irrestrito de redes de ensino, secretarias municipais, escolas atendidas e auditoria de segurança.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/admin/escolas"
              className="inline-flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 py-2.5 rounded-xl shadow-md transition text-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Nova Escola / Rede</span>
            </Link>
            <Link
              href="/auditoria"
              className="inline-flex items-center space-x-2 bg-white/10 hover:bg-white/20 text-white font-bold px-4 py-2.5 rounded-xl border border-white/20 shadow-sm transition text-xs"
            >
              <Activity className="w-4 h-4" />
              <span>Trilha de Auditoria</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Global SaaS KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Redes de Ensino
            </span>
            <Landmark className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            {metrics.totalNetworks}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            SEMECs & Mantenedoras
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Escolas Ativas
            </span>
            <Building2 className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          </div>
          <div className="text-2xl font-black text-sky-600 dark:text-sky-400 mt-1">
            {metrics.totalSchools}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Instâncias independentes
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Estudantes no SaaS
            </span>
            <GraduationCap className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            {metrics.totalStudents.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Monitorados em tempo real
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Disparos Globais
            </span>
            <Send className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">
            {metrics.totalMessages.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Mensagens WhatsApp enviadas
          </div>
        </div>
      </div>

      {/* Networks Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white flex items-center space-x-2">
              <Landmark className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>Redes de Ensino & Secretarias Municipais (SEMEC)</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Secretarias de educação com jurisdição municipal ou regional
            </p>
          </div>
          <Link
            href="/secretaria"
            className="inline-flex items-center text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            <span>Ver Painel Executivo SEMEC</span>
            <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Link>
        </div>

        {networks.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-500">
            Nenhuma rede municipal cadastrada ainda.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="text-[11px] text-slate-500 uppercase bg-slate-50 dark:bg-slate-800/60 font-semibold">
                <tr>
                  <th className="px-4 py-2.5 rounded-l-lg">Rede / Mantenedora</th>
                  <th className="px-4 py-2.5">Município / UF</th>
                  <th className="px-4 py-2.5">Tipo</th>
                  <th className="px-4 py-2.5 text-center">Escolas Vinculadas</th>
                  <th className="px-4 py-2.5 text-center">Gestores</th>
                  <th className="px-4 py-2.5 rounded-r-lg text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {networks.map((net) => (
                  <tr key={net.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">
                      {net.name}
                      <span className="block text-[10px] text-slate-400 font-normal">{net.shortName}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {net.city} - {net.state}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                          {net.type}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          net.edition === "PILOTO_INTEGRADA"
                            ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300"
                            : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                        }`}>
                          {net.edition === "PILOTO_INTEGRADA" ? "Piloto Integrada" : "Institucional"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-slate-800 dark:text-slate-200">
                      {net.schoolsCount}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-500">
                      {net.managersCount}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/secretaria?networkId=${net.id}`}
                        className="inline-flex items-center space-x-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        <span>Painel SEMEC</span>
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Directory of Schools with quick Access */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white flex items-center space-x-2">
              <Building2 className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              <span>Diretório Global de Escolas ({schools.length})</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Acesso direto para emular e gerenciar qualquer unidade escolar
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar escola, cidade, INEP..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="text-[11px] text-slate-500 uppercase bg-slate-50 dark:bg-slate-800/60 font-semibold">
              <tr>
                <th className="px-4 py-2.5 rounded-l-lg">Escola</th>
                <th className="px-4 py-2.5">INEP</th>
                <th className="px-4 py-2.5">Município</th>
                <th className="px-4 py-2.5">Rede</th>
                <th className="px-4 py-2.5 text-center">Alunos</th>
                <th className="px-4 py-2.5 text-center">Turmas</th>
                <th className="px-4 py-2.5 rounded-r-lg text-right">Ação SuperAdmin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredSchools.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">
                    {s.name}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-500">{s.inepCode}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{s.city}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        s.network === "MUNICIPAL"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                          : "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300"
                      }`}
                    >
                      {s.network}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center font-bold text-slate-800 dark:text-slate-200">
                    {s.studentsCount}
                  </td>
                  <td className="px-4 py-3 text-center text-slate-500">{s.classesCount}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end space-x-1.5">
                      {s.inepCode === "41042730" ? (
                        <span
                          title="Unidade sede de produção protegida contra exclusão"
                          className="inline-flex items-center space-x-1 px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-400 text-[10px] font-semibold rounded-lg border border-slate-200 dark:border-slate-700"
                        >
                          <Lock className="w-3 h-3 text-slate-400" />
                          <span>Sede</span>
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={sanitizingId === s.id || deletingId === s.id}
                            onClick={() => handleSanitizeSchool(s)}
                            title="Higienizar dados operacionais (zerar estudantes e turmas de teste)"
                            className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-amber-600 hover:border-amber-300 dark:hover:text-amber-400 dark:hover:border-amber-700 bg-white dark:bg-slate-800 text-xs font-semibold transition disabled:opacity-50"
                          >
                            {sanitizingId === s.id ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : (
                              <Eraser className="w-3 h-3 text-amber-500" />
                            )}
                            <span className="hidden lg:inline">Higienizar</span>
                          </button>

                          <button
                            type="button"
                            disabled={deletingId === s.id || sanitizingId === s.id}
                            onClick={() => handleDeleteSchool(s)}
                            title="Excluir instituição e todos os dados permanentemente"
                            className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 bg-white dark:bg-slate-800 text-xs font-semibold transition disabled:opacity-50"
                          >
                            {deletingId === s.id ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : (
                              <Trash2 className="w-3 h-3 text-red-500" />
                            )}
                            <span className="hidden lg:inline">Excluir</span>
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => handleAccessSchool(s.id)}
                        disabled={switchingId === s.id}
                        className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs font-bold rounded-lg transition"
                      >
                        {switchingId === s.id ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <ExternalLink className="w-3 h-3" />
                        )}
                        <span>Acessar</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Global Audit Feed */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-2xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white flex items-center space-x-2">
              <Activity className="w-4 h-4 text-emerald-600" />
              <span>Eventos Recentes de Auditoria & Segurança</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Trilha imutável de conformidade LGPD e acessos institucionais
            </p>
          </div>
          <Link href="/auditoria" className="text-xs font-bold text-indigo-600 hover:underline">
            Ver auditoria completa &rarr;
          </Link>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {auditLogs.map((log) => (
            <div key={log.id} className="py-2.5 flex items-center justify-between text-xs">
              <div className="flex items-center space-x-3">
                <span className="w-2 h-2 rounded-full bg-indigo-500" />
                <span className="font-bold text-slate-800 dark:text-slate-200">{log.action}</span>
                <span className="text-slate-400">•</span>
                <span className="text-slate-600 dark:text-slate-400">{log.userName}</span>
              </div>
              <span className="text-slate-400 text-[11px] font-mono">
                {new Date(log.createdAt).toLocaleString("pt-BR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
