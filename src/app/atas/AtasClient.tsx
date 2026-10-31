"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  BookOpenCheck,
  Plus,
  Search,
  Filter,
  FileCheck2,
  Lock,
  Printer,
  Calendar,
  AlertCircle,
  Clock,
  CheckCircle2,
  FileText,
  UserCheck,
  Trash2,
  ListTodo,
  ArrowRight,
} from "lucide-react";
import AtaEditorModal from "@/components/ata/AtaEditorModal";

interface Props {
  school: any;
  currentYear: number;
  availableStudents: any[];
  isAdmin?: boolean;
}

export default function AtasClient({
  school,
  currentYear,
  availableStudents,
  isAdmin = false,
}: Props) {
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [minutes, setMinutes] = useState<any[]>([]);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingMinute, setEditingMinute] = useState<any | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchMinutes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("year", String(selectedYear));
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (categoryFilter !== "ALL") params.set("category", categoryFilter);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());

      const res = await fetch(`/api/atas?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setMinutes(data.minutes || []);
      }
    } catch (e) {
      console.error("Erro ao buscar atas:", e);
    } finally {
      setLoading(false);
    }
  }, [selectedYear, statusFilter, categoryFilter, searchQuery]);

  useEffect(() => {
    fetchMinutes();
  }, [fetchMinutes]);

  const [finalizingId, setFinalizingId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const handleDeleteMinute = async (id: string) => {
    setDeletingId(id);
    setListError(null);
    try {
      const res = await fetch(`/api/atas/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao excluir ata");
      setConfirmDeleteId(null);
      await fetchMinutes();
    } catch (e: any) {
      setListError(e.message || "Erro ao excluir ata.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleQuickFinalize = async (m: any) => {
    setListError(null);
    if (!m.summary || m.summary.trim().length < 10) {
      setEditingMinute(m);
      setIsCreateModalOpen(true);
      return;
    }

    setFinalizingId(m.id);
    try {
      const res = await fetch(`/api/atas/${m.id}/finalize`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao lavrar ata");
      await fetchMinutes();
    } catch (e: any) {
      setListError(e.message || "Erro ao lavrar ata.");
    } finally {
      setFinalizingId(null);
    }
  };

  const finalizedCount = minutes.filter((m) => m.status === "FINALIZED").length;
  const draftCount = minutes.filter((m) => m.status === "DRAFT").length;
  const pendingActionsCount = minutes.reduce(
    (acc, m) => acc + (m.actionItems?.filter((a: any) => a.status === "PENDING").length || 0),
    0
  );

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 bg-sky-100 text-sky-700 rounded-2xl flex items-center justify-center shadow-inner">
            <BookOpenCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">
              Livro Oficial de Atas Pedagógicas
            </h1>
            <p className="text-xs text-slate-500 font-medium">
              {school.name} — Registros de Fé Pública e Acompanhamento Escolar
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/encaminhamentos"
            className="inline-flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/30 hover:bg-indigo-100 text-xs font-bold text-indigo-700 dark:text-indigo-300 transition"
          >
            <ListTodo className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Painel de Combinados</span>
          </Link>

          <Link
            href={`/atas/livro/${selectedYear}`}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 transition"
          >
            <Printer className="w-4 h-4 text-amber-500" />
            <span>Emitir Livro Anual ({selectedYear})</span>
          </Link>

          <button
            type="button"
            onClick={() => {
              setEditingMinute(null);
              setIsCreateModalOpen(true);
            }}
            className="inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold shadow-sm transition cursor-pointer"
          >
            <Plus className="w-4 h-4 text-sky-400" />
            <span>Lavrar Nova Ata</span>
          </button>
        </div>
      </div>

      {/* Cards de Métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span>Atas Lavradas ({selectedYear})</span>
            <FileCheck2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-black text-slate-900 mt-2">{finalizedCount}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Registros oficiais imutáveis</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span>Rascunhos em Aberto</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-black text-slate-900 mt-2">{draftCount}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Aguardando lavratura/assinatura</p>
        </div>

        <Link
          href="/encaminhamentos"
          className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs hover:border-indigo-300 hover:shadow-sm transition group"
        >
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span className="group-hover:text-indigo-600 transition">Encaminhamentos & Combinados</span>
            <ListTodo className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <p className="text-2xl font-black text-slate-900">{pendingActionsCount}</p>
            <span className="text-[11px] font-semibold text-indigo-600 group-hover:underline inline-flex items-center gap-0.5">
              Acessar painel <ArrowRight className="w-3 h-3" />
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">Prazos e compromissos das atas</p>
        </Link>
      </div>

      {/* Filtros e Busca */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 text-xs">
          <div className="md:col-span-5 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Buscar por estudante, assunto, servidora ou código..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl bg-slate-50/50 focus:bg-white text-slate-800 font-medium"
            />
          </div>

          <div className="md:col-span-2">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="w-full py-2.5 px-3 border border-slate-200 rounded-xl bg-slate-50/50 font-semibold text-slate-700"
            >
              {[currentYear, currentYear - 1, currentYear - 2].map((yr) => (
                <option key={yr} value={yr}>
                  Livro {yr}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full py-2.5 px-3 border border-slate-200 rounded-xl bg-slate-50/50 font-semibold text-slate-700"
            >
              <option value="ALL">Todos os Status</option>
              <option value="FINALIZED">Lavradas (Oficiais)</option>
              <option value="DRAFT">Rascunhos</option>
              <option value="VOIDED">Sem Efeito</option>
            </select>
          </div>

          <div className="md:col-span-3">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full py-2.5 px-3 border border-slate-200 rounded-xl bg-slate-50/50 font-semibold text-slate-700"
            >
              <option value="ALL">Todas as Categorias</option>
              <option value="ACOMPANHAMENTO_PEDAGOGICO">Acompanhamento / Rendimento</option>
              <option value="BUSCA_ATIVA_FALTAS">Busca Ativa / Frequência</option>
              <option value="CONVIVENCIA_INDISCIPLINA">Convivência / Conflitos</option>
              <option value="SAUDE_VULNERABILIDADE">Saúde / Vulnerabilidade</option>
              <option value="REDE_PROTECAO_CT">Rede de Proteção / CT</option>
              <option value="ORIENTACAO_ROTINA">Orientação de Rotina</option>
            </select>
          </div>
        </div>
      </div>

      {listError && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{listError}</span>
        </div>
      )}

      {/* Lista de Atas */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xs overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Carregando livro de atas...</div>
        ) : minutes.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <FileText className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm font-bold text-slate-700">Nenhuma ata encontrada</p>
            <p className="text-xs text-slate-400">
              Inicie um novo registro clicando no botão &quot;Lavrar Nova Ata&quot; acima.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {minutes.map((m) => {
              const isFinal = m.status === "FINALIZED";
              const isVoid = m.status === "VOIDED";
              const ataNumStr = m.ataNumber ? String(m.ataNumber).padStart(3, "0") : null;
              const isReadyToQuickFinalize =
                !isFinal && !isVoid && m.summary && m.summary.trim().length >= 10 && m.students?.length > 0;

              return (
                <div
                  key={m.id}
                  className="p-4 sm:p-5 hover:bg-slate-50/70 transition flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {isFinal ? (
                        <span className="px-2.5 py-1 rounded-md bg-emerald-100 text-emerald-800 text-[11px] font-extrabold font-mono">
                          Ata nº {ataNumStr}/{m.year}
                        </span>
                      ) : isVoid ? (
                        <span className="px-2.5 py-1 rounded-md bg-rose-100 text-rose-800 text-[11px] font-extrabold line-through">
                          Ata nº {ataNumStr}/{m.year} (Sem Efeito)
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-md bg-amber-100 text-amber-800 text-[11px] font-extrabold">
                          Rascunho em Edição
                        </span>
                      )}

                      {m.isConfidential && (
                        <span className="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 text-[10px] font-bold border border-rose-200 flex items-center space-x-1">
                          <Lock className="w-3 h-3" />
                          <span>Sigilo Reforçado</span>
                        </span>
                      )}

                      <span className="text-[11px] text-slate-400 flex items-center space-x-1">
                        <Calendar className="w-3 h-3" />
                        <span>{new Date(m.attendedAt).toLocaleDateString("pt-BR")}</span>
                      </span>
                    </div>

                    <h3 className="text-sm font-extrabold text-slate-900 truncate">
                      {m.subject}
                    </h3>

                    {/* Alunos Vinculados */}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                      <span className="font-bold text-slate-500">Estudante(s):</span>
                      {m.students?.map((s: any) => (
                        <Link
                          key={s.studentId}
                          href={`/alunos/${s.studentId}`}
                          className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-sky-50 text-sky-800 hover:bg-sky-100 font-semibold text-[11px] transition"
                        >
                          <span>{s.studentNameSnapshot}</span>
                          {s.classNameSnapshot && (
                            <span className="text-sky-600 text-[10px]">({s.classNameSnapshot})</span>
                          )}
                        </Link>
                      ))}
                    </div>

                    {/* Servidora e Participantes */}
                    <p className="text-[11px] text-slate-500">
                      Lavrado por: <strong>{m.authorName}</strong> • Presentes:{" "}
                      {m.participants?.map((p: any) => p.name).join(", ") || "Nenhum participante listado"}
                    </p>
                  </div>

                  {/* Ações */}
                  <div className="flex flex-wrap items-center gap-2 self-start md:self-center">
                    {isFinal && (
                      <Link
                        href={`/atas/${m.id}/imprimir`}
                        target="_blank"
                        className="p-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 transition"
                        title="Imprimir Via A4 com QR Code"
                      >
                        <Printer className="w-4 h-4" />
                      </Link>
                    )}

                    {!isFinal && !isVoid ? (
                      <>
                        {isReadyToQuickFinalize && (
                          <button
                            type="button"
                            onClick={() => handleQuickFinalize(m)}
                            disabled={finalizingId === m.id}
                            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition flex items-center space-x-1 cursor-pointer disabled:opacity-50"
                          >
                            <FileCheck2 className="w-3.5 h-3.5" />
                            <span>{finalizingId === m.id ? "Lavrando..." : "Lavrar Ata"}</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setEditingMinute(m);
                            setIsCreateModalOpen(true);
                          }}
                          className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer"
                        >
                          Editar / Lavrar
                        </button>

                        {confirmDeleteId === m.id ? (
                          <div className="flex items-center space-x-1">
                            <button
                              type="button"
                              onClick={() => handleDeleteMinute(m.id)}
                              disabled={deletingId === m.id}
                              className="px-2.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] transition cursor-pointer disabled:opacity-50"
                            >
                              {deletingId === m.id ? "..." : "Confirmar"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-[11px] cursor-pointer"
                            >
                              Não
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(m.id)}
                            className="p-2 rounded-xl border border-slate-200 hover:border-rose-200 hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition cursor-pointer"
                            title="Descartar rascunho"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMinute(m);
                            setIsCreateModalOpen(true);
                          }}
                          className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs transition cursor-pointer"
                        >
                          Ver Detalhes / Adendo
                        </button>

                        {isAdmin && (
                          confirmDeleteId === m.id ? (
                            <div className="flex items-center space-x-1 bg-rose-50 p-1 rounded-xl border border-rose-200">
                              <span className="text-[10px] text-rose-800 font-bold px-1.5">
                                Excluir definitivamente?
                              </span>
                              <button
                                type="button"
                                onClick={() => handleDeleteMinute(m.id)}
                                disabled={deletingId === m.id}
                                className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] transition cursor-pointer disabled:opacity-50"
                              >
                                {deletingId === m.id ? "..." : "Sim"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold text-[11px] cursor-pointer"
                              >
                                Não
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(m.id)}
                              className="p-2 rounded-xl border border-rose-200 bg-rose-50/70 hover:bg-rose-100 text-rose-600 hover:text-rose-700 transition cursor-pointer"
                              title="Excluir ata de teste (Acesso Administrador Geral)"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal Editor */}
      <AtaEditorModal
        isOpen={isCreateModalOpen}
        isAdmin={isAdmin}
        onClose={() => {
          setIsCreateModalOpen(false);
          setEditingMinute(null);
          fetchMinutes();
        }}
        onSaved={() => {
          fetchMinutes();
        }}
        availableStudents={availableStudents}
        existingMinute={editingMinute}
      />
    </div>
  );
}
