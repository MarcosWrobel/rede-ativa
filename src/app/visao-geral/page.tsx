import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getCurrentSchool } from "@/lib/currentSchool";
import { 
  Send, 
  History, 
  AlertTriangle, 
  BarChart3, 
  FileSpreadsheet,
  Users, 
  FileText,
  BookOpenCheck,
  ShieldCheck, 
  UserCheck,
  ArrowRight, 
  Clock, 
  CheckCircle2, 
  School,
  Stethoscope,
  ListTodo
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const currentSchool = await getCurrentSchool((session.user as any)?.schoolId);
  const schoolId = currentSchool.id;

  let totalStudents = 0;
  let totalLogs = 0;
  let totalReplied = 0;
  let recentLogs: any[] = [];
  let lowAttendanceCount = 0;
  let totalMinutes = 0;

  try {
    const results = await Promise.all([
      prisma.student.count({ where: { schoolId, active: true } }),
      prisma.messageLog.count({ where: { student: { schoolId } } }),
      prisma.messageLog.count({ where: { student: { schoolId }, guardianReplied: true } }),
      prisma.messageLog.findMany({
        where: { student: { schoolId } },
        take: 6,
        orderBy: { sentAt: "desc" },
        include: {
          student: { include: { classGroup: true } },
        },
      }),
      prisma.lowAttendanceRecord.count({ where: { student: { schoolId } } }),
      prisma.pedagogicalMinute.count({ where: { schoolId, status: "FINALIZED" } }),
    ]);
    totalStudents = results[0];
    totalLogs = results[1];
    totalReplied = results[2];
    recentLogs = results[3];
    lowAttendanceCount = results[4];
    totalMinutes = results[5];
  } catch (err) {
    console.error("[DashboardPage] Falha temporária ao carregar métricas:", err);
  }

  const sections = [
    {
      title: "1. Busca Ativa & Frequência",
      desc: "Monitoramento de faltas, contatos com a família e retorno de justificativas",
      cards: [
        {
          title: "Frequência e Alertas",
          desc: "Estudantes em risco crítico (<75%), alertas de queda abrupta e protocolos do SERP.",
          href: "/faltas",
          icon: AlertTriangle,
          color: "bg-amber-50 text-amber-700 border-amber-200",
          btnText: "Acessar",
        },
        {
          title: "Busca Ativa",
          desc: "Envio de mensagens individual ou fila assistida por turma com salto de atestados.",
          href: "/busca-ativa",
          icon: Send,
          color: "bg-sky-50 text-sky-700 border-sky-200",
          btnText: "Acessar",
        },
        {
          title: "Histórico de Contatos",
          desc: "Registro de mensagens enviadas, confirmação de entrega e triagem de justificativas.",
          href: "/historico",
          icon: History,
          color: "bg-emerald-50 text-emerald-700 border-emerald-200",
          btnText: "Acessar",
        },
      ],
    },
    {
      title: "2. Registro Pedagógico & Documentação",
      desc: "Base de estudantes, atestados médicos, livro oficial de atas e encaminhamentos",
      cards: [
        {
          title: "Estudantes e Turmas",
          desc: "Enturmação, importação SERE, prontuário individual e emissão de dossiê.",
          href: "/alunos",
          icon: Users,
          color: "bg-blue-50 text-blue-700 border-blue-200",
          btnText: "Acessar",
        },
        {
          title: "Atestados e Justificativas",
          desc: "Lançamento de atestados médicos, controle de vigência e cálculo de retorno.",
          href: "/atestados",
          icon: Stethoscope,
          color: "bg-emerald-50 text-emerald-700 border-emerald-200",
          btnText: "Acessar",
        },
        {
          title: "Livro de Atas",
          desc: "Lavratura de atas pedagógicas com fé pública, termos aditivos e livro anual.",
          href: "/atas",
          icon: BookOpenCheck,
          color: "bg-indigo-50 text-indigo-700 border-indigo-200",
          btnText: "Acessar",
        },
        {
          title: "Encaminhamentos e Prazos",
          desc: "Acompanhamento de prazos da Rede de Proteção, retornos da família e compromissos.",
          href: "/encaminhamentos",
          icon: ListTodo,
          color: "bg-violet-50 text-violet-700 border-violet-200",
          btnText: "Acessar",
        },
      ],
    },
    {
      title: "3. Diagnóstico & Gestão",
      desc: "Diagnósticos semanais de infrequência e relatórios consolidados",
      cards: [
        {
          title: "Boletim Semanal",
          desc: "Diagnóstico executivo semanal para a equipe pedagógica e equipe gestora.",
          href: "/boletim",
          icon: FileSpreadsheet,
          color: "bg-teal-50 text-teal-700 border-teal-200",
          btnText: "Acessar",
        },
        {
          title: "Relatórios",
          desc: "Indicadores de infrequência por turma, causas de ausência e contatos realizados.",
          href: "/relatorios",
          icon: BarChart3,
          color: "bg-purple-50 text-purple-700 border-purple-200",
          btnText: "Acessar",
        },
      ],
    },
    {
      title: "4. Sistema & Governança",
      desc: "Modelos institucionais de comunicado, permissões de acesso e auditoria",
      cards: [
        {
          title: "Modelos",
          desc: "Textos institucionais de comunicado organizados por turno e motivo.",
          href: "/modelos",
          icon: FileText,
          color: "bg-cyan-50 text-cyan-700 border-cyan-200",
          btnText: "Acessar",
        },
        {
          title: "Equipe",
          desc: "Gestão de acessos da equipe escolar e permissões por perfil.",
          href: "/equipe",
          icon: UserCheck,
          color: "bg-rose-50 text-rose-700 border-rose-200",
          btnText: "Acessar",
        },
        {
          title: "Auditoria",
          desc: "Registro de operações, acessos e integridade de dados.",
          href: "/auditoria",
          icon: ShieldCheck,
          color: "bg-slate-50 text-slate-700 border-slate-200",
          btnText: "Acessar",
        },
      ],
    },
  ];

  return (
    <div className="space-y-8">
      {/* Welcome banner */}
      <div className="bg-gradient-to-r from-sky-800 to-sky-600 rounded-2xl p-6 sm:p-8 text-white shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-start sm:items-center space-x-4">
          <div className="w-16 h-16 rounded-2xl bg-white p-1.5 shadow-md flex-shrink-0 hidden sm:flex items-center justify-center">
            <img src={currentSchool?.logoUrl || "/logo.svg"} alt={currentSchool?.name || "Rede Ativa"} className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="inline-flex items-center space-x-2 bg-white/10 px-3 py-1 rounded-full text-xs font-semibold backdrop-blur-xs mb-2 border border-white/20">
              <School className="w-3.5 h-3.5" />
              <span>{currentSchool?.name || "Rede Ativa"}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Visão Geral
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/busca-ativa"
            className="inline-flex items-center space-x-2 bg-white text-sky-800 hover:bg-sky-50 font-bold px-4 py-2.5 rounded-xl shadow-sm transition whitespace-nowrap text-xs"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Busca Ativa</span>
          </Link>
          <Link
            href="/atas"
            className="inline-flex items-center space-x-2 bg-sky-950/40 hover:bg-sky-950/60 text-white font-bold px-4 py-2.5 rounded-xl border border-white/20 shadow-sm transition whitespace-nowrap text-xs"
          >
            <BookOpenCheck className="w-3.5 h-3.5" />
            <span>Livro de Atas</span>
          </Link>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total de Estudantes</div>
          <div className="text-2xl font-black text-slate-900 mt-1">{totalStudents}</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Mensagens Enviadas</div>
          <div className="text-2xl font-black text-sky-600 mt-1">{totalLogs.toLocaleString()}</div>
          <div className="text-xs text-slate-500 mt-0.5">{totalReplied} retornos confirmados</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Infrequência e Risco</div>
          <div className="text-2xl font-black text-amber-600 mt-1">{lowAttendanceCount}</div>
          <div className="text-xs text-slate-500 mt-0.5">Estudantes monitorados</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Atas Lavradas</div>
          <div className="text-2xl font-black text-indigo-600 mt-1">{totalMinutes}</div>
        </div>
      </div>

      {/* Categorized Sections */}
      <div className="space-y-8">
        {sections.map((section) => (
          <div key={section.title} className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-1 border-b border-slate-200">
              <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-800">
                {section.title}
              </h2>
              <span className="text-xs text-slate-500">{section.desc}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {section.cards.map((card) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.href}
                    className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs hover:shadow-md transition flex flex-col justify-between group"
                  >
                    <div>
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center border mb-3 ${card.color}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <h3 className="text-base font-bold text-slate-900 group-hover:text-sky-600 transition">
                        {card.title}
                      </h3>
                      <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{card.desc}</p>
                    </div>
                    <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
                      <Link
                        href={card.href}
                        className="inline-flex items-center text-xs font-bold text-sky-600 hover:text-sky-800 transition"
                      >
                        <span>{card.btnText}</span>
                        <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-1 transition" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Recent Activity Table */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 flex items-center space-x-2">
            <Clock className="w-4 h-4 text-sky-600" />
            <span>Últimos Contatos</span>
          </h2>
          <Link href="/historico" className="text-xs font-bold text-sky-600 hover:text-sky-800">
            Ver todos ({totalLogs}) &rarr;
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 bg-slate-50 uppercase font-semibold">
              <tr>
                <th className="px-4 py-2.5 rounded-l-lg">Estudante</th>
                <th className="px-4 py-2.5">Turma</th>
                <th className="px-4 py-2.5">Motivo</th>
                <th className="px-4 py-2.5">Pedagoga</th>
                <th className="px-4 py-2.5">Data / Hora</th>
                <th className="px-4 py-2.5 rounded-r-lg text-center">Retorno</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-medium text-slate-900">{log.student?.name || "Estudante"}</td>
                  <td className="px-4 py-3 text-slate-600">{log.student?.classGroup?.name || "Geral"}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-50 text-sky-700 border border-sky-100">
                      {log.reasonTitle || "Contato"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{log.sentByName || "Equipe"}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {new Date(log.sentAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {log.guardianReplied ? (
                      <span className="inline-flex items-center text-xs font-semibold text-emerald-600">
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Sim
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Pendente</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
