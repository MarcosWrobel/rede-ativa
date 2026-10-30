"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  FileText,
  Send,
  Phone,
  Users,
  Stethoscope,
  ClipboardSignature,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Star,
  Trash2,
  PhoneOff,
  ShieldAlert,
  Calendar,
  MessageSquare,
  BookOpenCheck,
  Printer,
  QrCode,
  Lock,
} from "lucide-react";
import AtaEditorModal from "@/components/ata/AtaEditorModal";
import ModalDialog from "@/components/ModalDialog";
import {
  KINSHIP_LABELS,
  JUSTIFICATION_TYPE_LABELS,
  parseEnrollmentDetailMetrics,
  detectAbruptDrop,
  getActiveJustification,
} from "@/lib/pedagogicalClassifier";
import {
  DELIVERY_STATUS_LABELS,
  REPLY_CATEGORY_LABELS,
  type DeliveryStatus,
  type ReplyCategory,
} from "@/lib/whatsappProvider";

interface Props {
  initialStudent: any;
  initialContacts: any[];
  initialJustifications: any[];
  initialAttendances: any[];
  initialSnapshots: any[];
  initialMinutes?: any[];
  currentUser: {
    name: string;
    email: string;
  };
}

type TabKey = "overview" | "contacts" | "justifications" | "timeline";

export default function ProntuarioClient({
  initialStudent,
  initialContacts,
  initialJustifications,
  initialAttendances,
  initialSnapshots,
  initialMinutes = [],
}: Props) {
  const [student, setStudent] = useState<any>(initialStudent);
  const [contacts, setContacts] = useState<any[]>(initialContacts);
  const [justifications, setJustifications] = useState<any[]>(initialJustifications);
  const [attendances, setAttendances] = useState<any[]>(initialAttendances);
  const [minutes, setMinutes] = useState<any[]>(initialMinutes);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [isAtaEditorOpen, setIsAtaEditorOpen] = useState(false);

  // Modal: Novo Contato
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [contactForm, setContactForm] = useState({
    name: "",
    kinship: "MAE",
    phone: "",
    isPrimary: false,
    whatsappValid: true,
    notes: "",
  });
  const [contactError, setContactError] = useState("");
  const [isSavingContact, setIsSavingContact] = useState(false);

  // Modal: Novo Atestado / Justificativa
  const [isJustModalOpen, setIsJustModalOpen] = useState(false);
  const todayStr = new Date().toISOString().slice(0, 10);
  const [justForm, setJustForm] = useState({
    type: "ATESTADO_MEDICO",
    startDate: todayStr,
    endDate: todayStr,
    cidCode: "",
    notes: "",
  });
  const [justError, setJustError] = useState("");
  const [isSavingJust, setIsSavingJust] = useState(false);

  // Modal: Nova Ata Presencial
  const [isAttModalOpen, setIsAttModalOpen] = useState(false);
  const [attForm, setAttForm] = useState({
    attendedAt: todayStr,
    guardianPresent: initialStudent.guardianName || "",
    subject: "Acompanhamento Pedagógico e Busca Ativa Escolar",
    summary: "",
    agreements: "",
  });
  const [attError, setAttError] = useState("");
  const [isSavingAtt, setIsSavingAtt] = useState(false);

  const lowAtt = student.lowAttendanceRecord;
  const detailMetrics = useMemo(
    () => parseEnrollmentDetailMetrics(lowAtt?.enrollmentDetail),
    [lowAtt]
  );

  const abruptDrop = useMemo(() => {
    if (!lowAtt) return { isAbruptDrop: false, dropDelta: null, reason: null };
    return detectAbruptDrop({
      attendancePercent: lowAtt.attendancePercent,
      weeklyPercent: detailMetrics.weeklyNum,
      previousWeeklyPercent: detailMetrics.prevWeeklyNum,
      snapshots: initialSnapshots,
    });
  }, [lowAtt, detailMetrics, initialSnapshots]);

  const activeJustification = useMemo(
    () => getActiveJustification(justifications),
    [justifications]
  );

  const chronologicalSnapshots = useMemo(
    () => [...initialSnapshots].reverse(),
    [initialSnapshots]
  );

  const cgm = student.cgm || detailMetrics.cgm || "Não vinculado";
  const repliedCount = (student.messageLogs || []).filter((m: any) => m.guardianReplied).length;

  // --- Handlers: Contacts ---
  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingContact(true);
    setContactError("");

    try {
      const res = await fetch(`/api/students/${student.id}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao cadastrar contato");

      setContacts((prev) => {
        const next = contactForm.isPrimary
          ? prev.map((c) => ({ ...c, isPrimary: false }))
          : prev;
        return [data, ...next];
      });

      if (contactForm.isPrimary) {
        setStudent((prev: any) => ({
          ...prev,
          phone: data.phone,
          guardianName: data.name,
        }));
      }

      setIsContactModalOpen(false);
      setContactForm({
        name: "",
        kinship: "MAE",
        phone: "",
        isPrimary: false,
        whatsappValid: true,
        notes: "",
      });
    } catch (err: any) {
      setContactError(err.message);
    } finally {
      setIsSavingContact(false);
    }
  };

  const handleToggleWhatsappValid = async (c: any) => {
    try {
      const res = await fetch(`/api/students/${student.id}/contacts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: c.id,
          whatsappValid: !c.whatsappValid,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setContacts((prev) => prev.map((item) => (item.id === c.id ? updated : item)));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSetPrimaryContact = async (c: any) => {
    try {
      const res = await fetch(`/api/students/${student.id}/contacts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: c.id,
          isPrimary: true,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setContacts((prev) =>
          prev.map((item) =>
            item.id === c.id ? updated : { ...item, isPrimary: false }
          )
        );
        setStudent((prev: any) => ({
          ...prev,
          phone: updated.phone,
          guardianName: updated.name,
        }));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteContact = async (contactId: string) => {
    try {
      const res = await fetch(
        `/api/students/${student.id}/contacts?contactId=${contactId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setContacts((prev) => prev.filter((item) => item.id !== contactId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  // --- Handlers: Justifications ---
  const handleCreateJustification = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingJust(true);
    setJustError("");

    try {
      const res = await fetch(`/api/students/${student.id}/justifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(justForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao registrar atestado");

      setJustifications((prev) => [data, ...prev]);
      setIsJustModalOpen(false);
      setJustForm({
        type: "ATESTADO_MEDICO",
        startDate: todayStr,
        endDate: todayStr,
        cidCode: "",
        notes: "",
      });
    } catch (err: any) {
      setJustError(err.message);
    } finally {
      setIsSavingJust(false);
    }
  };

  const handleDeleteJustification = async (justificationId: string) => {
    try {
      const res = await fetch(
        `/api/students/${student.id}/justifications?justificationId=${justificationId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setJustifications((prev) => prev.filter((j) => j.id !== justificationId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  // --- Handlers: In-Person Attendance ---
  const handleCreateAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingAtt(true);
    setAttError("");

    try {
      const res = await fetch(`/api/students/${student.id}/attendances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao salvar ata presencial");

      setAttendances((prev) => [data, ...prev]);
      setIsAttModalOpen(false);
      setAttForm({
        attendedAt: todayStr,
        guardianPresent: student.guardianName || "",
        subject: "Acompanhamento Pedagógico e Busca Ativa Escolar",
        summary: "",
        agreements: "",
      });
    } catch (err: any) {
      setAttError(err.message);
    } finally {
      setIsSavingAtt(false);
    }
  };

  const handleDeleteAttendance = async (attendanceId: string) => {
    try {
      const res = await fetch(
        `/api/students/${student.id}/attendances?attendanceId=${attendanceId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setAttendances((prev) => prev.filter((a) => a.id !== attendanceId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Navegação Superior */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-3 text-xs font-semibold text-slate-600">
          <Link
            href="/alunos"
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Cadastro de Alunos</span>
          </Link>
          <Link
            href="/faltas"
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 transition"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
            <span>Painel de Frequência</span>
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/busca-ativa?studentId=${student.id}`}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-xs transition"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Acionar via WhatsApp</span>
          </Link>

          <Link
            href={`/alunos/${student.id}/dossie`}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition"
          >
            <FileText className="w-3.5 h-3.5 text-amber-400" />
            <span>Emitir Dossiê Oficial (PDF)</span>
          </Link>
        </div>
      </div>

      {/* Cabeçalho 360º do Estudante */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 sm:p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                CGM: {cgm}
              </span>
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-md bg-sky-50 text-sky-800 border border-sky-200">
                {student.classGroup.name} • {student.classGroup.segment} ({student.classGroup.shift})
              </span>
              {activeJustification && (
                <span className="inline-flex items-center space-x-1 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                  <Stethoscope className="w-3.5 h-3.5 text-emerald-700" />
                  <span>
                    Atestado Vigente até{" "}
                    {new Date(activeJustification.endDate).toLocaleDateString("pt-BR")}
                  </span>
                </span>
              )}
              {abruptDrop.isAbruptDrop && (
                <span
                  title={abruptDrop.reason || ""}
                  className="inline-flex items-center space-x-1 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300"
                >
                  <TrendingDown className="w-3.5 h-3.5 text-rose-700" />
                  <span>Queda Abrupta Recente</span>
                </span>
              )}
            </div>

            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              {student.name}
            </h1>

            <p className="text-xs text-slate-600">
              Responsável Principal:{" "}
              <strong>{student.guardianName || "Não informado"}</strong> • Telefone Principal:{" "}
              <strong className="font-mono">{student.phone || "Não informado"}</strong>
            </p>
          </div>

          {/* Indicador Rápido de Frequência */}
          {lowAtt ? (
            <div
              className={`px-4 py-3 rounded-xl border text-right min-w-[180px] ${
                lowAtt.attendancePercent < 75
                  ? "bg-red-50 border-red-200 text-red-900"
                  : lowAtt.attendancePercent < 85
                  ? "bg-amber-50 border-amber-200 text-amber-900"
                  : "bg-emerald-50 border-emerald-200 text-emerald-900"
              }`}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider block opacity-75">
                Frequência Geral (Power BI)
              </span>
              <span className="text-2xl font-black">
                {lowAtt.attendancePercent.toFixed(1)}%
              </span>
              {detailMetrics.semanaAtual && (
                <span className="block text-[11px] font-mono mt-0.5">
                  Semana atual: <strong>{detailMetrics.semanaAtual}</strong>
                </span>
              )}
            </div>
          ) : (
            <div className="px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-right">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                Frequência Power BI
              </span>
              <span className="text-xs font-semibold text-slate-600">
                Sem registro de alerta
              </span>
            </div>
          )}
        </div>

        {/* Abas do Prontuário */}
        <div
          role="tablist"
          aria-label="Seções do Prontuário 360º"
          className="flex flex-wrap gap-1.5 pt-3 border-t border-slate-100"
        >
          {(
            [
              {
                id: "overview",
                label: "Visão Geral & Série de Frequência",
                icon: TrendingUp,
              },
              {
                id: "contacts",
                label: `Contatos da Família (${contacts.length + 1})`,
                icon: Phone,
              },
              {
                id: "justifications",
                label: `Atestados & Justificativas (${justifications.length})`,
                icon: Stethoscope,
              },
              {
                id: "timeline",
                label: `Atas Presenciais (${attendances.length}) & Histórico (${student.messageLogs?.length || 0})`,
                icon: ClipboardSignature,
              },
            ] as Array<{ id: TabKey; label: string; icon: any }>
          ).map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                type="button"
                aria-selected={selected}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition ${
                  selected
                    ? "bg-sky-600 text-white shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ABA 1: VISÃO GERAL & SÉRIE HISTÓRICA DE FREQUÊNCIA */}
      {activeTab === "overview" && (
        <div role="tabpanel" className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <span className="text-[11px] font-bold uppercase text-slate-500">
                Buscas Ativas (WhatsApp)
              </span>
              <div className="text-2xl font-black text-slate-900 mt-1">
                {student.messageLogs?.length || 0}
              </div>
              <span className="text-[11px] text-emerald-700 font-semibold">
                {repliedCount} com retorno da família
              </span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <span className="text-[11px] font-bold uppercase text-slate-500">
                Atendimentos Presenciais
              </span>
              <div className="text-2xl font-black text-slate-900 mt-1">
                {attendances.length}
              </div>
              <span className="text-[11px] text-slate-500">
                Atas assinadas na escola
              </span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <span className="text-[11px] font-bold uppercase text-slate-500">
                Atestados Registrados
              </span>
              <div className="text-2xl font-black text-slate-900 mt-1">
                {justifications.length}
              </div>
              <span className="text-[11px] text-slate-500">
                {activeJustification ? "1 vigente hoje" : "Nenhum vigente hoje"}
              </span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <span className="text-[11px] font-bold uppercase text-slate-500">
                Status Rede de Proteção
              </span>
              <div className="text-sm font-black text-purple-800 mt-2 truncate">
                {lowAtt?.serpStatus || "Sem ficha SERP"}
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                {lowAtt?.serpProtocol ? `Protocolo #${lowAtt.serpProtocol}` : "Acompanhamento interno"}
              </span>
            </div>
          </div>

          {abruptDrop.isAbruptDrop && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 flex items-start space-x-3 text-xs">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-extrabold block text-sm">
                  Alerta Preventivo de Queda Abrupta Detectado
                </strong>
                <p className="mt-0.5">{abruptDrop.reason}.</p>
              </div>
            </div>
          )}

          {/* Série Histórica Semanal (AttendanceSnapshot) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider">
                  Evolução Semanal de Frequência (Série Histórica Power BI)
                </h2>
                <p className="text-xs text-slate-500">
                  Linha vermelha tracejada indica o limite mínimo legal da LDB (75% de presença).
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500">
                {chronologicalSnapshots.length} semana(s) arquivada(s)
              </span>
            </div>

            {chronologicalSnapshots.length > 0 ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3 pt-2">
                  {chronologicalSnapshots.map((snap: any) => {
                    const p = Number(snap.attendancePercent || 0);
                    const isCrit = p < 75;
                    const isAtt = p >= 75 && p < 85;
                    return (
                      <div
                        key={snap.id}
                        className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex flex-col justify-between space-y-2"
                      >
                        <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
                          <strong>{snap.referenceWeek}</strong>
                          <span>
                            {new Date(snap.recordedAt).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                            })}
                          </span>
                        </div>

                        <div className="h-24 bg-slate-200/70 rounded-lg relative flex items-end overflow-hidden p-1">
                          {/* Linha de 75% */}
                          <div
                            className="absolute inset-x-0 border-t border-dashed border-red-500/80 z-10"
                            style={{ bottom: "75%" }}
                            title="Mínimo Legal 75%"
                          />
                          <div
                            className={`w-full rounded-md transition-all ${
                              isCrit
                                ? "bg-red-500"
                                : isAtt
                                ? "bg-amber-500"
                                : "bg-emerald-500"
                            }`}
                            style={{ height: `${Math.min(100, Math.max(6, p))}%` }}
                          />
                        </div>

                        <div className="text-center">
                          <span
                            className={`text-xs font-black ${
                              isCrit
                                ? "text-red-700"
                                : isAtt
                                ? "text-amber-700"
                                : "text-emerald-700"
                            }`}
                          >
                            {p.toFixed(1)}%
                          </span>
                          {snap.weeklyPercent !== null && snap.weeklyPercent !== undefined && (
                            <span className="block text-[10px] font-mono text-slate-500">
                              Sem: {Number(snap.weeklyPercent).toFixed(0)}%
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                {lowAtt ? (
                  <>
                    Leitura atual registrada: <strong>{lowAtt.attendancePercent.toFixed(1)}%</strong>{" "}
                    ({lowAtt.enrollmentDetail || "Power BI"}). Novos snapshots semanais serão
                    adicionados automaticamente a cada sincronização da extensão Power BI.
                  </>
                ) : (
                  "Ainda não há snapshots semanais gravados para este estudante."
                )}
              </div>
            )}
          </div>

          {/* Parecer SERP / Medidas Adotadas */}
          {lowAtt && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-6 space-y-3 text-xs">
              <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider">
                Medidas Adotadas & Registro SERP / Rede de Proteção
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block">Protocolo SERP:</span>
                  <strong className="font-mono text-slate-900">
                    {lowAtt.serpProtocol || "Não informado"}
                  </strong>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block">Situação SERP:</span>
                  <strong className="text-slate-900">
                    {lowAtt.serpStatus || "Em monitoramento escolar"}
                  </strong>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block">Última Atualização:</span>
                  <strong className="text-slate-900">
                    {new Date(lowAtt.updatedAt).toLocaleString("pt-BR")}
                  </strong>
                </div>
              </div>
              {lowAtt.actionsTaken && (
                <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-slate-800">
                  <strong className="block text-amber-900 mb-1">Resumo de Ações:</strong>
                  {lowAtt.actionsTaken}
                </div>
              )}
              {lowAtt.serpDetails && (
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 whitespace-pre-wrap font-mono text-[11px]">
                  {lowAtt.serpDetails}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ABA 2: MÚLTIPLOS CONTATOS DA FAMÍLIA */}
      {activeTab === "contacts" && (
        <div role="tabpanel" className="bg-white rounded-xl border border-slate-200 shadow-2xs p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider">
                Rede de Contatos Familiares do Estudante
              </h2>
              <p className="text-xs text-slate-500">
                Cadastre Mãe, Pai, Avós ou Telefone de Recado e sinalize números sem WhatsApp.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsContactModalOpen(true)}
              className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-xs transition"
            >
              <Plus className="w-4 h-4" />
              <span>Adicionar Contato Familiar</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Contato Base do Cadastro */}
            <div className="p-4 rounded-xl border-2 border-sky-200 bg-sky-50/40 flex flex-col justify-between space-y-3 text-xs">
              <div className="flex items-start justify-between">
                <div>
                  <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-sky-600 text-white text-[10px] font-bold uppercase">
                    <Star className="w-3 h-3" />
                    <span>Cadastro Principal Atual</span>
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 mt-1.5">
                    {student.guardianName || "Responsável Principal"}
                  </h3>
                  <p className="font-mono text-slate-700 mt-0.5">
                    {student.phone || "Sem telefone informado no SERE"}
                  </p>
                </div>
                {student.phone && (
                  <Link
                    href={`/busca-ativa?studentId=${student.id}&phone=${student.phone}`}
                    className="px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold text-[11px]"
                  >
                    Enviar WhatsApp
                  </Link>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                Este é o telefone padrão sincronizado com a ficha cadastral do estudante.
              </p>
            </div>

            {/* Contatos Adicionais (StudentContact) */}
            {contacts.map((c) => (
              <div
                key={c.id}
                className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 text-xs ${
                  c.whatsappValid
                    ? "border-slate-200 bg-white"
                    : "border-rose-200 bg-rose-50/40"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold text-[10px]">
                        {KINSHIP_LABELS[c.kinship] || c.kinship}
                      </span>
                      {c.isPrimary && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold text-[10px]">
                          Principal
                        </span>
                      )}
                      {!c.whatsappValid && (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold text-[10px]">
                          <PhoneOff className="w-3 h-3" />
                          <span>Sem WhatsApp / Desatualizado</span>
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 mt-1.5">{c.name}</h3>
                    <p className="font-mono text-slate-700 mt-0.5">{c.phone}</p>
                    {c.notes && (
                      <p className="text-[11px] text-slate-500 italic mt-1">{c.notes}</p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteContact(c.id)}
                    title="Remover contato"
                    className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleToggleWhatsappValid(c)}
                      className={`px-2.5 py-1 rounded-lg font-bold text-[11px] border transition ${
                        c.whatsappValid
                          ? "border-slate-200 text-slate-600 hover:bg-slate-100"
                          : "border-emerald-300 bg-emerald-50 text-emerald-800"
                      }`}
                    >
                      {c.whatsappValid ? "Sinalizar Sem WhatsApp" : "Marcar WhatsApp Válido"}
                    </button>

                    {!c.isPrimary && (
                      <button
                        type="button"
                        onClick={() => handleSetPrimaryContact(c)}
                        className="px-2.5 py-1 rounded-lg font-bold text-[11px] border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 transition"
                      >
                        Definir Principal
                      </button>
                    )}
                  </div>

                  <Link
                    href={`/busca-ativa?studentId=${student.id}&phone=${c.phone}`}
                    className="px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 font-bold text-[11px]"
                  >
                    Acionar este nº
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ABA 3: ATESTADOS MÉDICOS & JUSTIFICATIVAS */}
      {activeTab === "justifications" && (
        <div role="tabpanel" className="bg-white rounded-xl border border-slate-200 shadow-2xs p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider">
                Atestados Médicos & Justificativas de Ausência
              </h2>
              <p className="text-xs text-slate-500">
                Atestados vigentes sinalizam automaticamente o aluno com o selo 🩺 nos painéis de envio.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsJustModalOpen(true)}
              className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition"
            >
              <Plus className="w-4 h-4" />
              <span>Registrar Atestado / Justificativa</span>
            </button>
          </div>

          {justifications.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-6 text-center">
              Nenhum atestado ou justificativa formal registrada para este aluno.
            </p>
          ) : (
            <div className="space-y-3">
              {justifications.map((j) => {
                const isCurrentlyActive = getActiveJustification([j]) !== null;
                return (
                  <div
                    key={j.id}
                    className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs ${
                      isCurrentlyActive
                        ? "border-emerald-300 bg-emerald-50/50"
                        : "border-slate-200 bg-slate-50/50"
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-900">
                          {JUSTIFICATION_TYPE_LABELS[j.type] || j.type}
                        </span>
                        {isCurrentlyActive ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-extrabold">
                            🩺 VIGENTE HOJE
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[10px] font-bold">
                            Encerrado
                          </span>
                        )}
                        {j.cidCode && (
                          <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
                            CID: {j.cidCode}
                          </span>
                        )}
                      </div>

                      <div className="text-slate-700 font-medium">
                        Vigência:{" "}
                        <strong>
                          {new Date(j.startDate).toLocaleDateString("pt-BR")}
                        </strong>{" "}
                        até{" "}
                        <strong>
                          {new Date(j.endDate).toLocaleDateString("pt-BR")}
                        </strong>
                      </div>

                      {j.notes && <p className="text-slate-600 italic">{j.notes}</p>}

                      <div className="text-[11px] text-slate-400">
                        Registrado por {j.createdByName} em{" "}
                        {new Date(j.createdAt).toLocaleDateString("pt-BR")}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteJustification(j.id)}
                      title="Excluir registro de atestado"
                      className="self-end sm:self-center p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ABA 4: ATAS PEDAGÓGICAS OFICIAIS & LINHA DO TEMPO */}
      {activeTab === "timeline" && (
        <div role="tabpanel" className="space-y-6">
          {/* Atas Pedagógicas Oficiais (Novo Livro Oficial) */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xs p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center space-x-1.5">
                  <BookOpenCheck className="w-4 h-4 text-sky-600" />
                  <span>1. Livro Oficial de Atas Pedagógicas</span>
                </h2>
                <p className="text-xs text-slate-500">
                  Atas lavradas com fé pública, assinatura em tela/mobile, hash SHA-256 e numeração sequencial oficial.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAtaEditorOpen(true)}
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold shadow-sm transition cursor-pointer"
              >
                <Plus className="w-4 h-4 text-sky-400" />
                <span>Lavrar Nova Ata Digital</span>
              </button>
            </div>

            {minutes.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-3 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                Nenhuma ata do novo Livro Oficial lavrada para este(a) estudante ainda.
              </p>
            ) : (
              <div className="space-y-3">
                {minutes.map((m) => {
                  const isFinal = m.status === "FINALIZED";
                  const isVoid = m.status === "VOIDED";
                  const numStr = m.ataNumber ? String(m.ataNumber).padStart(3, "0") : null;

                  return (
                    <div
                      key={m.id}
                      className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-2 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            {isFinal ? (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-mono font-extrabold text-[11px]">
                                Ata nº {numStr}/{m.year}
                              </span>
                            ) : isVoid ? (
                              <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 font-mono font-extrabold text-[11px] line-through">
                                Ata nº {numStr}/{m.year} (Sem Efeito)
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 font-extrabold text-[11px]">
                                Rascunho
                              </span>
                            )}

                            {m.isConfidential && (
                              <span className="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 text-[10px] font-bold border border-rose-200 flex items-center space-x-1">
                                <Lock className="w-3 h-3" />
                                <span>Sigilo Reforçado</span>
                              </span>
                            )}

                            <span className="text-slate-400 text-[11px]">
                              {new Date(m.attendedAt).toLocaleDateString("pt-BR")}
                            </span>
                          </div>

                          <h3 className="text-sm font-extrabold text-slate-900">
                            {m.subject}
                          </h3>

                          <p className="text-slate-600">
                            Lavrada por: <strong>{m.authorName}</strong> • Presentes:{" "}
                            {m.participants?.map((p: any) => p.name).join(", ") || "Nenhum informado"}
                          </p>
                        </div>

                        {isFinal && (
                          <Link
                            href={`/atas/${m.id}/imprimir`}
                            target="_blank"
                            className="p-2 rounded-xl border border-slate-200 hover:bg-white text-slate-700 transition"
                            title="Imprimir Via A4 Oficial"
                          >
                            <Printer className="w-4 h-4" />
                          </Link>
                        )}
                      </div>

                      <p className="text-slate-700 leading-relaxed font-serif bg-white p-3 rounded-xl border border-slate-100">
                        {m.summary}
                      </p>

                      {m.agreementsSummary && (
                        <p className="text-sky-900 bg-sky-50 p-2 rounded-lg border border-sky-100 text-[11px]">
                          <strong>Combinados:</strong> {m.agreementsSummary}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Histórico Anterior (Atas Legadas InPersonAttendance) */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  2. Atendimentos Presenciais Anteriores (Histórico Legado)
                </h2>
                <p className="text-[11px] text-slate-400">
                  Registros simples anteriores à implantação do Livro Oficial Digital.
                </p>
              </div>
            </div>

            {attendances.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-4 text-center">
                Nenhum atendimento presencial registrado até o momento.
              </p>
            ) : (
              <div className="space-y-3">
                {attendances.map((att) => (
                  <div
                    key={att.id}
                    className="p-4 rounded-xl border border-purple-200/80 bg-purple-50/30 space-y-2 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="inline-flex items-center space-x-1 font-mono text-[11px] font-bold text-purple-800">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>{new Date(att.attendedAt).toLocaleDateString("pt-BR")}</span>
                        </span>
                        <h3 className="text-sm font-extrabold text-slate-900 mt-0.5">
                          {att.subject}
                        </h3>
                        <p className="text-slate-600">
                          Familiar presente: <strong>{att.guardianPresent}</strong> • Atendido por:{" "}
                          <strong>{att.recordedByName}</strong>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteAttendance(att.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition"
                        title="Remover ata"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="p-3 rounded-lg bg-white border border-slate-200 text-slate-700 whitespace-pre-wrap">
                      {att.summary}
                    </div>

                    {att.agreements && (
                      <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900">
                        <strong>Encaminhamentos / Compromissos firmados:</strong> {att.agreements}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Linha do Tempo Completa de Comunicações (WhatsApp) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-6 space-y-4">
            <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
              <MessageSquare className="w-4 h-4 text-sky-600" />
              <span>
                2. Linha do Tempo Auditada de Acionamentos WhatsApp ({student.messageLogs?.length || 0})
              </span>
            </h2>

            {!student.messageLogs || student.messageLogs.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-4 text-center">
                Nenhuma mensagem enviada para este estudante até o momento.
              </p>
            ) : (
              <div className="space-y-3">
                {student.messageLogs.map((log: any) => (
                  <div
                    key={log.id}
                    className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-bold text-slate-700">
                          {new Date(log.sentAt).toLocaleDateString("pt-BR")}{" "}
                          {new Date(log.sentAt).toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 font-bold">
                          {log.reasonTitle}
                        </span>
                        <span className="text-slate-500">
                          por <strong>{log.sentByName}</strong> (Fone: {log.phoneUsed})
                        </span>
                        {log.deliveryStatus === "FAILED_NO_WHATSAPP" ? (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold text-[10px]">
                            <PhoneOff className="w-3 h-3" />
                            <span>Tentativa frustrada (Sem WhatsApp)</span>
                          </span>
                        ) : log.deliveryStatus ? (
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold text-[10px]">
                            {DELIVERY_STATUS_LABELS[log.deliveryStatus as DeliveryStatus] ||
                              log.deliveryStatus}
                          </span>
                        ) : null}
                      </div>

                      {log.guardianReplied ? (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Família Retornou</span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-600 font-semibold text-[11px]">
                          Sem Retorno
                        </span>
                      )}
                    </div>

                    {(log.replyCategory || log.replyNotes) && (
                      <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-1">
                        {log.replyCategory && (
                          <span className="inline-block px-2 py-0.5 rounded-md bg-white border border-emerald-300 text-emerald-900 font-bold text-[10px]">
                            Causa: {REPLY_CATEGORY_LABELS[log.replyCategory as ReplyCategory] || log.replyCategory}
                          </span>
                        )}
                        {log.replyNotes && (
                          <div>
                            <strong>Retorno da família:</strong> {log.replyNotes}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 1: Adicionar Contato Familiar */}
      <ModalDialog
        open={isContactModalOpen}
        onClose={() => setIsContactModalOpen(false)}
        title="Novo Contato Familiar"
        subtitle={`Estudante: ${student.name}`}
      >
        <form onSubmit={handleCreateContact} className="space-y-3 text-xs">
          {contactError && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700">
              {contactError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-slate-700 block mb-1">
                Nome do Contato / Familiar:
              </label>
              <input
                type="text"
                required
                autoFocus
                placeholder="Ex: Maria da Silva"
                value={contactForm.name}
                onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
              />
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">
                Grau de Parentesco:
              </label>
              <select
                value={contactForm.kinship}
                onChange={(e) => setContactForm({ ...contactForm, kinship: e.target.value })}
                className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
              >
                {Object.entries(KINSHIP_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Telefone WhatsApp (com DDD):
            </label>
            <input
              type="tel"
              required
              placeholder="Ex: 42999887766"
              value={contactForm.phone}
              onChange={(e) =>
                setContactForm({ ...contactForm, phone: e.target.value.replace(/\D/g, "") })
              }
              className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white font-mono"
            />
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Observação (Horário de trabalho, recado, etc.):
            </label>
            <input
              type="text"
              placeholder="Opcional..."
              value={contactForm.notes}
              onChange={(e) => setContactForm({ ...contactForm, notes: e.target.value })}
              className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
            />
          </div>

          <label className="flex items-center space-x-2 pt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={contactForm.isPrimary}
              onChange={(e) =>
                setContactForm({ ...contactForm, isPrimary: e.target.checked })
              }
              className="rounded border-slate-300 text-sky-600"
            />
            <span className="font-semibold text-slate-700">
              Definir também como telefone principal do aluno
            </span>
          </label>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsContactModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSavingContact}
              className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold"
            >
              {isSavingContact ? "Salvando..." : "Salvar Contato"}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* MODAL 2: Registrar Atestado / Justificativa */}
      <ModalDialog
        open={isJustModalOpen}
        onClose={() => setIsJustModalOpen(false)}
        title="Registrar Atestado ou Justificativa"
        subtitle={`Estudante: ${student.name}`}
      >
        <form onSubmit={handleCreateJustification} className="space-y-3 text-xs">
          {justError && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700">
              {justError}
            </div>
          )}

          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Tipo de Documento / Justificativa:
            </label>
            <select
              value={justForm.type}
              onChange={(e) => setJustForm({ ...justForm, type: e.target.value })}
              className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
            >
              {Object.entries(JUSTIFICATION_TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-slate-700 block mb-1">
                Início da Vigência:
              </label>
              <input
                type="date"
                required
                value={justForm.startDate}
                onChange={(e) => setJustForm({ ...justForm, startDate: e.target.value })}
                className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white font-mono"
              />
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">
                Término da Vigência:
              </label>
              <input
                type="date"
                required
                value={justForm.endDate}
                onChange={(e) => setJustForm({ ...justForm, endDate: e.target.value })}
                className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white font-mono"
              />
            </div>
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Código CID (Opcional — uso restrito pedagógico):
            </label>
            <input
              type="text"
              placeholder="Opcional"
              value={justForm.cidCode}
              onChange={(e) => setJustForm({ ...justForm, cidCode: e.target.value })}
              className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white font-mono"
            />
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Observações / Detalhes da Entrega:
            </label>
            <textarea
              rows={3}
              placeholder="Ex: Atestado médico entregue pela mãe na secretaria; aluno em repouso domiciliar."
              value={justForm.notes}
              onChange={(e) => setJustForm({ ...justForm, notes: e.target.value })}
              className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsJustModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSavingJust}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              {isSavingJust ? "Registrando..." : "Salvar Atestado"}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* MODAL 3: Registrar Ata Presencial */}
      <ModalDialog
        open={isAttModalOpen}
        onClose={() => setIsAttModalOpen(false)}
        title="Registrar Ata de Comparecimento Presencial"
        subtitle={`Estudante: ${student.name}`}
      >
        <form onSubmit={handleCreateAttendance} className="space-y-3 text-xs">
          {attError && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700">
              {attError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-slate-700 block mb-1">
                Data do Comparecimento:
              </label>
              <input
                type="date"
                required
                value={attForm.attendedAt}
                onChange={(e) => setAttForm({ ...attForm, attendedAt: e.target.value })}
                className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white font-mono"
              />
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">
                Familiar / Responsável Presente:
              </label>
              <input
                type="text"
                required
                autoFocus
                placeholder="Ex: Maria da Silva (Mãe)"
                value={attForm.guardianPresent}
                onChange={(e) =>
                  setAttForm({ ...attForm, guardianPresent: e.target.value })
                }
                className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Pauta / Motivo da Convocação:
            </label>
            <input
              type="text"
              required
              value={attForm.subject}
              onChange={(e) => setAttForm({ ...attForm, subject: e.target.value })}
              className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
            />
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Síntese da Reunião / Relato da Família:
            </label>
            <textarea
              rows={4}
              required
              placeholder="Descreva os esclarecimentos prestados pela família e orientações da equipe pedagógica..."
              value={attForm.summary}
              onChange={(e) => setAttForm({ ...attForm, summary: e.target.value })}
              className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
            />
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Compromissos / Encaminhamentos Firmados (Opcional):
            </label>
            <textarea
              rows={2}
              placeholder="Ex: Responsável assinou termo de acompanhamento e comprometeu-se a justificar eventuais faltas..."
              value={attForm.agreements}
              onChange={(e) => setAttForm({ ...attForm, agreements: e.target.value })}
              className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsAttModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSavingAtt}
              className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-bold"
            >
              {isSavingAtt ? "Registrando..." : "Salvar Ata Presencial"}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Modal do Novo Livro Oficial de Atas Pedagógicas */}
      <AtaEditorModal
        isOpen={isAtaEditorOpen}
        onClose={() => setIsAtaEditorOpen(false)}
        onSaved={async () => {
          setIsAtaEditorOpen(false);
          try {
            const res = await fetch(`/api/atas?studentId=${student.id}`);
            const data = await res.json();
            if (res.ok) setMinutes(data.minutes || []);
          } catch (e) {
            console.error("Erro ao atualizar atas do aluno:", e);
          }
        }}
        availableStudents={[
          {
            id: student.id,
            name: student.name,
            classGroupName: student.classGroup?.name,
            cgm: student.cgm,
            phone: student.phone,
            guardianName: student.guardianName,
          },
        ]}
        preSelectedStudentId={student.id}
      />
    </div>
  );
}
