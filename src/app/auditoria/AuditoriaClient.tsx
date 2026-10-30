"use client";

import { useState, useMemo } from "react";
import {
  ShieldCheck,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface Props {
  initialLogs: any[];
}

export default function AuditoriaClient({ initialLogs }: Props) {
  const [logs] = useState<any[]>(initialLogs);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAction, setSelectedAction] = useState("TODOS");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      const term = searchTerm.toLowerCase();
      const matchSearch =
        !term ||
        l.userName.toLowerCase().includes(term) ||
        l.userEmail.toLowerCase().includes(term) ||
        (l.ipAddress && l.ipAddress.toLowerCase().includes(term)) ||
        (l.details && l.details.toLowerCase().includes(term));

      const matchAction = selectedAction === "TODOS" || l.action === selectedAction;

      return matchSearch && matchAction;
    });
  }, [logs, searchTerm, selectedAction]);

  const totalPages = Math.ceil(filteredLogs.length / pageSize) || 1;
  const paginatedLogs = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredLogs.slice(start, start + pageSize);
  }, [filteredLogs, page, pageSize]);

  const getActionBadge = (action: string) => {
    switch (action) {
      case "SEND_MESSAGE":
        return <span className="px-2 py-0.5 rounded font-bold bg-sky-50 text-sky-700 border border-sky-200">Envio de Mensagem</span>;
      case "CREATE_STUDENT":
        return <span className="px-2 py-0.5 rounded font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Cadastro de Aluno</span>;
      case "UPDATE_STUDENT":
        return <span className="px-2 py-0.5 rounded font-bold bg-amber-50 text-amber-700 border border-amber-200">Edição de Aluno</span>;
      case "DELETE_STUDENT":
        return <span className="px-2 py-0.5 rounded font-bold bg-red-50 text-red-700 border border-red-200">Inativação de Aluno</span>;
      case "MARK_REPLY":
        return <span className="px-2 py-0.5 rounded font-bold bg-purple-50 text-purple-700 border border-purple-200">Retorno de Responsável</span>;
      case "UPDATE_MESSAGE_LOG":
        return <span className="px-2 py-0.5 rounded font-bold bg-amber-50 text-amber-800 border border-amber-200">Edição de Histórico</span>;
      case "DELETE_MESSAGE_LOG":
        return <span className="px-2 py-0.5 rounded font-bold bg-rose-50 text-rose-700 border border-rose-200">Exclusão de Histórico</span>;
      case "USER_LOGIN":
        return <span className="px-2 py-0.5 rounded font-bold bg-slate-100 text-slate-700 border border-slate-200">Login no Sistema</span>;
      case "LOGIN_DENIED":
        return <span className="px-2 py-0.5 rounded font-bold bg-red-100 text-red-800 border border-red-300">Login Bloqueado</span>;
      case "CREATE_USER":
        return <span className="px-2 py-0.5 rounded font-bold bg-teal-50 text-teal-800 border border-teal-200">Autorização Equipe</span>;
      case "UPDATE_USER":
        return <span className="px-2 py-0.5 rounded font-bold bg-blue-50 text-blue-800 border border-blue-200">Alteração Perfil</span>;
      case "DEACTIVATE_USER":
        return <span className="px-2 py-0.5 rounded font-bold bg-orange-50 text-orange-800 border border-orange-200">Revogação Equipe</span>;
      case "UPDATE_LOW_ATTENDANCE":
        return <span className="px-2 py-0.5 rounded font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">Sincronização / Faltas</span>;
      case "GENERATE_DOSSIER":
        return <span className="px-2 py-0.5 rounded font-bold bg-slate-900 text-white">Emissão Dossiê PDF</span>;
      case "CREATE_JUSTIFICATION":
        return <span className="px-2 py-0.5 rounded font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">Registro de Atestado</span>;
      case "DELETE_JUSTIFICATION":
        return <span className="px-2 py-0.5 rounded font-bold bg-rose-50 text-rose-800 border border-rose-200">Exclusão de Atestado</span>;
      case "CREATE_IN_PERSON_ATTENDANCE":
        return <span className="px-2 py-0.5 rounded font-bold bg-purple-50 text-purple-800 border border-purple-200">Ata Presencial</span>;
      case "DELETE_IN_PERSON_ATTENDANCE":
        return <span className="px-2 py-0.5 rounded font-bold bg-rose-50 text-rose-800 border border-rose-200">Exclusão Ata Presencial</span>;
      case "CREATE_STUDENT_CONTACT":
      case "UPDATE_STUDENT_CONTACT":
      case "DELETE_STUDENT_CONTACT":
        return <span className="px-2 py-0.5 rounded font-bold bg-sky-50 text-sky-800 border border-sky-200">Contato Familiar</span>;
      case "INITIAL_DATABASE_MIGRATION":
        return <span className="px-2 py-0.5 rounded font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">Migração Inicial</span>;
      default:
        return <span className="px-2 py-0.5 rounded font-bold bg-slate-100 text-slate-700">{action}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
            <ShieldCheck className="w-6 h-6 text-emerald-600" />
            <span>Trilha de Auditoria & Conformidade</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Registro imutável de todas as interações com dados sensíveis escolares, e-mail institucional, IP de origem e carimbo de data/hora.
          </p>
        </div>
        <div className="text-xs text-slate-500 font-medium">
          Total de <strong>{logs.length}</strong> eventos auditados
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Buscar por nome, e-mail, IP ou dados da ação..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
            />
          </div>

          <select
            value={selectedAction}
            onChange={(e) => {
              setSelectedAction(e.target.value);
              setPage(1);
            }}
            className="border border-slate-300 rounded-lg p-2 bg-slate-50 focus:bg-white"
          >
            <option value="TODOS">Todas as Ações</option>
            <option value="SEND_MESSAGE">Envio de Mensagem</option>
            <option value="CREATE_STUDENT">Cadastro de Aluno</option>
            <option value="UPDATE_STUDENT">Edição de Aluno</option>
            <option value="DELETE_STUDENT">Inativação de Aluno</option>
            <option value="MARK_REPLY">Retorno de Responsável</option>
            <option value="UPDATE_LOW_ATTENDANCE">Sincronização / Faltas</option>
            <option value="USER_LOGIN">Login no Sistema</option>
            <option value="LOGIN_DENIED">Login Bloqueado</option>
            <option value="CREATE_USER">Autorização Equipe</option>
            <option value="UPDATE_USER">Alteração Perfil</option>
            <option value="DEACTIVATE_USER">Revogação Equipe</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Data / Hora Exata</th>
                <th className="px-4 py-3">Usuário Responsável</th>
                <th className="px-4 py-3">E-mail @escola</th>
                <th className="px-4 py-3">IP Origem</th>
                <th className="px-4 py-3">Tipo de Ação</th>
                <th className="px-4 py-3">Detalhes Registrados</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedLogs.map((log) => {
                const dt = new Date(log.createdAt);
                let parsedDetails = null;
                try {
                  parsedDetails = JSON.parse(log.details || "{}");
                } catch {
                  parsedDetails = log.details;
                }

                return (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-4 py-3 font-mono text-slate-600 whitespace-nowrap">
                      {dt.toLocaleDateString("pt-BR")}{" "}
                      <span className="text-[11px] text-slate-400">
                        {dt.toLocaleTimeString("pt-BR")}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                      {log.userName}
                    </td>
                    <td className="px-4 py-3 font-mono text-sky-700 whitespace-nowrap">
                      {log.userEmail}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {log.ipAddress || "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {getActionBadge(log.action)}
                    </td>
                    <td className="px-4 py-3 text-slate-600 font-mono text-[11px]">
                      {typeof parsedDetails === "object" && parsedDetails !== null ? (
                        <div className="max-w-md truncate">
                          {Object.entries(parsedDetails).map(([k, v]) => (
                            <span key={k} className="mr-2">
                              <strong>{k}:</strong> {typeof v === "object" ? JSON.stringify(v) : String(v)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="truncate max-w-md block">{String(parsedDetails || "")}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {paginatedLogs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Nenhum registro de auditoria encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <div>
            Página <strong>{page}</strong> de <strong>{totalPages}</strong>
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded border border-slate-300 bg-white disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded border border-slate-300 bg-white disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
