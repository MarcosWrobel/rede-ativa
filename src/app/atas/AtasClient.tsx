"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
  QrCode,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  HeartPulse,
  Users,
  AlertTriangle,
  X,
  GraduationCap,
  Camera,
  Download,
  Paperclip,
} from "lucide-react";
import AtaEditorModal from "@/components/ata/AtaEditorModal";
import PhysicalScanModal from "@/components/ata/PhysicalScanModal";
import AtaQrCode from "@/components/ata/AtaQrCode";
import { getAtaValidationUrl, getBaseAppUrl } from "@/lib/qrCode";

function getCategoryConfig(category?: string) {
  switch (category) {
    case "ORIENTACAO_DOCENTE":
      return {
        label: "Orientação Docente",
        className: "bg-indigo-50 text-indigo-900 border-indigo-200",
        icon: GraduationCap,
      };
    case "BUSCA_ATIVA_FALTAS":
      return {
        label: "Busca Ativa / Frequência",
        className: "bg-amber-50 text-amber-900 border-amber-200",
        icon: AlertTriangle,
      };
    case "ACOMPANHAMENTO_PEDAGOGICO":
      return {
        label: "Acompanhamento / Rendimento",
        className: "bg-sky-50 text-sky-900 border-sky-200",
        icon: BookOpenCheck,
      };
    case "CONVIVENCIA_INDISCIPLINA":
      return {
        label: "Convivência / Mediação",
        className: "bg-purple-50 text-purple-900 border-purple-200",
        icon: Users,
      };
    case "SAUDE_VULNERABILIDADE":
      return {
        label: "Saúde / Vulnerabilidade",
        className: "bg-rose-50 text-rose-900 border-rose-200",
        icon: HeartPulse,
      };
    case "REDE_PROTECAO_CT":
      return {
        label: "Rede de Proteção / CT",
        className: "bg-red-50 text-red-900 border-red-200",
        icon: ShieldAlert,
      };
    case "ORIENTACAO_ROTINA":
      return {
        label: "Orientação de Rotina",
        className: "bg-slate-100 text-slate-800 border-slate-200",
        icon: Clock,
      };
    default:
      return {
        label: category || "Atendimento Pedagógico",
        className: "bg-slate-50 text-slate-700 border-slate-200",
        icon: BookOpenCheck,
      };
  }
}

interface Props {
  school: any;
  currentYear: number;
  availableStudents: any[];
  isAdmin?: boolean;
  initialStudentId?: string;
  initialCreateOpen?: boolean;
  initialCategory?: string;
}

export default function AtasClient({
  school,
  currentYear,
  availableStudents,
  isAdmin = false,
  initialStudentId,
  initialCreateOpen = false,
  initialCategory,
}: Props) {
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>(initialCategory || "ALL");
  const [physicalScanFilter, setPhysicalScanFilter] = useState<"ALL" | "ATTACHED" | "PENDING">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [minutes, setMinutes] = useState<any[]>([]);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(Boolean(initialCreateOpen));
  const [selectedStudentForDraft, setSelectedStudentForDraft] = useState<string | undefined>(initialStudentId);
  const [editingMinute, setEditingMinute] = useState<any | null>(null);
  const [scanningMinute, setScanningMinute] = useState<any | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Modal de Validação Pública & QR Code
  const [selectedMinuteForQr, setSelectedMinuteForQr] = useState<any | null>(null);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [copiedValidationUrl, setCopiedValidationUrl] = useState(false);
  const [origin, setOrigin] = useState<string>(() => {
    if (typeof window !== "undefined" && window.location.origin) {
      return window.location.origin;
    }
    return getBaseAppUrl();
  });

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.origin) {
      setOrigin(window.location.origin);
    }
  }, []);

  const handleCopyValidationUrl = async (verificationCode: string) => {
    const url = getAtaValidationUrl(verificationCode, origin);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedValidationUrl(true);
      setTimeout(() => setCopiedValidationUrl(false), 2500);
    } catch {
      prompt("Copie o link de validação oficial:", url);
    }
  };

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

  const displayedMinutes = useMemo(() => {
    if (physicalScanFilter === "ALL") return minutes;
    if (physicalScanFilter === "ATTACHED") {
      return minutes.filter(
        (m) => Boolean(m.hasPhysicalScan || m.physicalSignedScanData || m.govBrVerified)
      );
    }
    if (physicalScanFilter === "PENDING") {
      return minutes.filter(
        (m) =>
          m.status === "FINALIZED" &&
          !m.hasPhysicalScan &&
          !m.physicalSignedScanData &&
          !m.govBrVerified
      );
    }
    return minutes;
  }, [minutes, physicalScanFilter]);

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
              Livro de Atas Pedagógicas
            </h1>
            <p className="text-xs text-slate-500 font-medium">
              {school.name}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/encaminhamentos"
            className="inline-flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/30 hover:bg-indigo-100 text-xs font-bold text-indigo-700 dark:text-indigo-300 transition"
          >
            <ListTodo className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Encaminhamentos</span>
          </Link>

          <Link
            href={`/atas/livro/${selectedYear}`}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 transition"
          >
            <Printer className="w-4 h-4 text-amber-500" />
            <span>Livro Anual ({selectedYear})</span>
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
            <span>Nova Ata</span>
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
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span>Rascunhos</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-black text-slate-900 mt-2">{draftCount}</p>
        </div>

        <Link
          href="/encaminhamentos"
          className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs hover:border-indigo-300 hover:shadow-sm transition group"
        >
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span className="group-hover:text-indigo-600 transition">Encaminhamentos Pendentes</span>
            <ListTodo className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <p className="text-2xl font-black text-slate-900">{pendingActionsCount}</p>
            <span className="text-[11px] font-semibold text-indigo-600 group-hover:underline inline-flex items-center gap-0.5">
              Ver todos <ArrowRight className="w-3 h-3" />
            </span>
          </div>
        </Link>
      </div>

      {/* Filtros e Busca */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 text-xs">
          <div className="md:col-span-4 relative">
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

          <div className="md:col-span-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full py-2.5 px-3 border border-slate-200 rounded-xl bg-slate-50/50 font-semibold text-slate-700"
            >
              <option value="ALL">Todas as Categorias</option>
              <option value="ORIENTACAO_DOCENTE">Orientação Docente</option>
              <option value="ACOMPANHAMENTO_PEDAGOGICO">Acompanhamento / Rendimento</option>
              <option value="BUSCA_ATIVA_FALTAS">Busca Ativa / Frequência</option>
              <option value="CONVIVENCIA_INDISCIPLINA">Convivência / Conflitos</option>
              <option value="SAUDE_VULNERABILIDADE">Saúde / Vulnerabilidade</option>
              <option value="REDE_PROTECAO_CT">Rede de Proteção / CT</option>
              <option value="ORIENTACAO_ROTINA">Orientação de Rotina</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              value={physicalScanFilter}
              onChange={(e) => setPhysicalScanFilter(e.target.value as any)}
              className="w-full py-2.5 px-3 border border-slate-200 rounded-xl bg-slate-50/50 font-semibold text-slate-700"
              title="Filtrar por status do arquivo da via física / digitalização"
            >
              <option value="ALL">Arquivo: Todos</option>
              <option value="ATTACHED">Com Via Física / Gov.br</option>
              <option value="PENDING">Pendente de Anexo</option>
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
        ) : displayedMinutes.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <FileText className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm font-bold text-slate-700">Nenhuma ata encontrada</p>
            <p className="text-xs text-slate-400">
              Nenhuma ata registrada para os filtros selecionados.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {displayedMinutes.map((m) => {
              const isFinal = m.status === "FINALIZED";
              const isVoid = m.status === "VOIDED";
              const ataNumStr = m.ataNumber ? String(m.ataNumber).padStart(3, "0") : null;
              const isReadyToQuickFinalize =
                !isFinal &&
                !isVoid &&
                m.summary &&
                m.summary.trim().length >= 10 &&
                ((m.students && m.students.length > 0) || (m.participants && m.participants.length > 0));

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

                      {/* Badge de Tipologia / Categoria */}
                      {(() => {
                        const cat = getCategoryConfig(m.category);
                        const CatIcon = cat.icon;
                        return (
                          <span
                            className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-md border text-[11px] font-bold ${cat.className}`}
                          >
                            <CatIcon className="w-3 h-3 shrink-0" />
                            <span>{cat.label}</span>
                          </span>
                        );
                      })()}

                      {m.isConfidential && (
                        <span className="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 text-[10px] font-bold border border-rose-200 flex items-center space-x-1">
                          <Lock className="w-3 h-3" />
                          <span>Sigilo Reforçado</span>
                        </span>
                      )}

                      {/* Badge de Arquivamento Físico e Gov.br (apenas para atas lavradas) */}
                      {isFinal && (
                        <>
                          {m.hasPhysicalScan || m.physicalSignedScanData ? (
                            <span
                              className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200"
                              title={
                                m.govBrVerified
                                  ? `Autenticado via Gov.br (${m.govBrProtocol || "ITI"})`
                                  : "Via física assinada digitalizada"
                              }
                            >
                              <FileCheck2 className="w-3 h-3 text-emerald-600" />
                              <span>{m.govBrVerified ? "Gov.br Anexo" : "Via Física Anexa"}</span>
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[10px] font-bold border border-amber-200"
                              title="Pendente de digitalização da folha assinada pelos participantes"
                            >
                              <Paperclip className="w-3 h-3 text-amber-600" />
                              <span>Pendente de Anexo</span>
                            </span>
                          )}
                        </>
                      )}

                      <span className="text-[11px] text-slate-400 flex items-center space-x-1">
                        <Calendar className="w-3 h-3" />
                        <span>{new Date(m.attendedAt).toLocaleDateString("pt-BR")}</span>
                      </span>
                    </div>

                    <h3 className="text-sm font-extrabold text-slate-900 truncate">
                      {m.subject}
                    </h3>

                    {/* Alunos ou Docentes Vinculados */}
                    {m.students && m.students.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                        <span className="font-bold text-slate-500">Estudante(s):</span>
                        {m.students.map((s: any) => (
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
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                        <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200">
                          Orientação Docente
                        </span>
                        {m.participants
                          ?.filter((p: any) => p.role === "PROFESSOR" || p.role === "EQUIPE_ESCOLAR")
                          .map((p: any) => (
                            <span
                              key={p.id || p.name}
                              className="px-2 py-0.5 rounded-lg bg-purple-50 text-purple-800 font-semibold text-[11px]"
                            >
                              {p.name}
                            </span>
                          ))}
                      </div>
                    )}

                    {/* Servidora e Participantes */}
                    <p className="text-[11px] text-slate-500">
                      Lavrado por: <strong>{m.authorName}</strong> • Presentes:{" "}
                      {m.participants?.map((p: any) => p.name).join(", ") || "Nenhum participante listado"}
                    </p>
                  </div>

                  {/* Ações */}
                  <div className="flex flex-wrap items-center gap-2 self-start md:self-center">
                    {isFinal && (
                      <>
                        <button
                          type="button"
                          onClick={() => setScanningMinute(m)}
                          className={`p-2 rounded-xl border transition cursor-pointer ${
                            m.hasPhysicalScan || m.physicalSignedScanData
                              ? "border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700"
                              : "border-slate-200 hover:bg-indigo-50 hover:border-indigo-200 text-slate-700 hover:text-indigo-700"
                          }`}
                          title={
                            m.hasPhysicalScan || m.physicalSignedScanData
                              ? "Visualizar ou substituir via física / Gov.br"
                              : "Digitalizar folha assinada ou anexar Gov.br"
                          }
                        >
                          <Camera className="w-4 h-4" />
                        </button>

                        <a
                          href={`/api/atas/${m.id}/pdfa?download=1`}
                          className="p-2 rounded-xl border border-slate-200 hover:bg-sky-50 hover:border-sky-200 text-slate-700 hover:text-sky-700 transition"
                          title="Baixar Certidão Arquivística PDF/A-1b (ISO 19005-1 Level B)"
                        >
                          <Download className="w-4 h-4 text-sky-600" />
                        </a>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedMinuteForQr(m);
                            setIsQrModalOpen(true);
                            setCopiedValidationUrl(false);
                          }}
                          className="p-2 rounded-xl border border-slate-200 hover:bg-emerald-50 hover:border-emerald-200 text-slate-700 hover:text-emerald-700 transition cursor-pointer"
                          title="Visualizar QR Code e Certidão de Validação Pública"
                        >
                          <QrCode className="w-4 h-4" />
                        </button>

                        <Link
                          href={`/atas/${m.id}/imprimir`}
                          target="_blank"
                          className="p-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 transition"
                          title="Imprimir Via A4 com QR Code"
                        >
                          <Printer className="w-4 h-4" />
                        </Link>
                      </>
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
                          Editar
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
          setSelectedStudentForDraft(undefined);
          fetchMinutes();
        }}
        onSaved={() => {
          fetchMinutes();
        }}
        availableStudents={availableStudents}
        preSelectedStudentId={selectedStudentForDraft}
        existingMinute={editingMinute}
      />

      {/* Modal de Validação Pública & QR Code */}
      {isQrModalOpen && selectedMinuteForQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-5 relative">
            <button
              type="button"
              onClick={() => {
                setIsQrModalOpen(false);
                setSelectedMinuteForQr(null);
              }}
              className="absolute top-5 right-5 p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900">
                  Validação e Fé Pública Digital
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  Ata nº {String(selectedMinuteForQr.ataNumber).padStart(3, "0")}/{selectedMinuteForQr.year}
                </p>
              </div>
            </div>

            {/* QR Code de Alta Resolução Autônomo */}
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 flex flex-col items-center justify-center space-y-3">
              <div className="w-44 h-44 bg-white p-2 rounded-xl shadow-xs border border-slate-200 flex items-center justify-center">
                <AtaQrCode
                  value={
                    selectedMinuteForQr.verificationCode
                      ? getAtaValidationUrl(selectedMinuteForQr.verificationCode, origin)
                      : ""
                  }
                  size={160}
                  className="w-full h-full"
                  alt="QR Code de Validação"
                />
              </div>
              <div className="text-center">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                  Código de Autenticação
                </span>
                <span className="text-lg font-black font-mono tracking-widest text-slate-900">
                  {selectedMinuteForQr.verificationCode || "Pendente"}
                </span>
              </div>
            </div>

            {/* Ações Rápidas */}
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => handleCopyValidationUrl(selectedMinuteForQr.verificationCode)}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold flex items-center justify-center space-x-2 transition cursor-pointer"
              >
                {copiedValidationUrl ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>Link Copiado com Sucesso!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copiar Link de Validação</span>
                  </>
                )}
              </button>

              <div className="flex items-center gap-2">
                <Link
                  href={`/validar/ata/${selectedMinuteForQr.verificationCode}`}
                  target="_blank"
                  className="flex-1 py-2 px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center justify-center space-x-1.5 transition"
                >
                  <span>Abrir Certidão Cega</span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                </Link>

                <Link
                  href={`/atas/${selectedMinuteForQr.id}/imprimir`}
                  target="_blank"
                  className="py-2 px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center justify-center space-x-1.5 transition"
                >
                  <Printer className="w-3.5 h-3.5 text-slate-400" />
                  <span>Imprimir A4</span>
                </Link>
              </div>
            </div>

            {/* Aviso de Conformidade Legal */}
            <div className="bg-amber-50/60 p-3 rounded-xl border border-amber-200/60 text-[11px] text-amber-900 space-y-1">
              <p className="font-bold">Privacidade e Fé Pública (ECA Arts. 17 e 143):</p>
              <p className="text-amber-800 leading-relaxed text-[10px]">
                O portal público de validação exibe apenas a Certidão Cega com confirmação de autenticidade e integridade criptográfica SHA-256 com nomes e documentos mascarados, protegendo o sigilo pedagógico.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Captura de Via Física e Assinatura Gov.br (JUR-04) */}
      <PhysicalScanModal
        isOpen={Boolean(scanningMinute)}
        minute={scanningMinute}
        onClose={() => setScanningMinute(null)}
        onSuccess={(updated) => {
          const hasScan = Boolean(
            updated.physicalSignedScanData || updated.physicalScanStorageKey
          );
          setMinutes((prev) =>
            prev.map((m) =>
              m.id === updated.id
                ? {
                    ...m,
                    ...updated,
                    hasPhysicalScan: hasScan,
                  }
                : m
            )
          );
          setScanningMinute(null);
        }}
      />
    </div>
  );
}
