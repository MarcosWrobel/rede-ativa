import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { 
  Send, 
  History, 
  AlertTriangle, 
  BarChart3, 
  Users, 
  ShieldCheck, 
  ArrowRight, 
  Clock, 
  CheckCircle2, 
  TrendingUp,
  School
} from "lucide-react";

export default async function DashboardPage() {
  const session = await auth();

  // Load quick metrics from DB
  const [
    totalStudents,
    totalLogs,
    totalReplied,
    recentLogs,
    lowAttendanceCount,
  ] = await Promise.all([
    prisma.student.count({ where: { active: true } }),
    prisma.messageLog.count(),
    prisma.messageLog.count({ where: { guardianReplied: true } }),
    prisma.messageLog.findMany({
      take: 6,
      orderBy: { sentAt: "desc" },
      include: {
        student: { include: { classGroup: true } },
      },
    }),
    prisma.lowAttendanceRecord.count(),
  ]);

  const cards = [
    {
      title: "Painel de Envio",
      desc: "Selecionar turma, aluno e disparar mensagem via WhatsApp com registro e prévia instantânea.",
      href: "/busca-ativa",
      icon: Send,
      color: "bg-sky-50 text-sky-700 border-sky-200",
      btnText: "Iniciar Envios",
    },
    {
      title: "Histórico de Envios",
      desc: "Consultar os 3.300+ envios registrados, filtrar por período e marcar retornos dos pais.",
      href: "/historico",
      icon: History,
      color: "bg-emerald-50 text-emerald-700 border-emerald-200",
      btnText: "Ver Histórico",
    },
    {
      title: "Controle de Faltas & Busca Ativa",
      desc: "Ranking de acionamentos por infrequência e acompanhamento SERP / Conselho Tutelar.",
      href: "/faltas",
      icon: AlertTriangle,
      color: "bg-amber-50 text-amber-700 border-amber-200",
      btnText: "Monitorar Faltas",
    },
    {
      title: "Relatórios & Estatísticas",
      desc: "Gráficos de ocorrências por motivo, produtividade por pedagoga e índices de retorno.",
      href: "/relatorios",
      icon: BarChart3,
      color: "bg-purple-50 text-purple-700 border-purple-200",
      btnText: "Ver Relatórios",
    },
    {
      title: "Alunos & Turmas",
      desc: "Cadastrar novos alunos, ajustar telefones dos responsáveis e gerenciar turmas.",
      href: "/alunos",
      icon: Users,
      color: "bg-blue-50 text-blue-700 border-blue-200",
      btnText: "Gerenciar Alunos",
    },
    {
      title: "Trilha de Auditoria",
      desc: "Registro imutável de quem realizou cada envio, edição de aluno ou alteração no sistema.",
      href: "/auditoria",
      icon: ShieldCheck,
      color: "bg-slate-50 text-slate-700 border-slate-200",
      btnText: "Ver Auditoria",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Welcome banner */}
      <div className="bg-gradient-to-r from-sky-800 to-sky-600 rounded-2xl p-6 sm:p-8 text-white shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <div className="inline-flex items-center space-x-2 bg-white/10 px-3 py-1 rounded-full text-xs font-semibold backdrop-blur-xs mb-3 border border-white/20">
            <School className="w-3.5 h-3.5" />
            <span>Colégio Estadual Leopoldina B. Pedroso</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Olá, {session?.user?.name || "Equipe Pedagógica"}!
          </h1>
          <p className="text-sky-100 text-sm mt-1 max-w-xl">
            Bem-vinda ao sistema centralizado de Busca Ativa e Comunicação Escolar. Todos os contatos e alterações são gravados com sua identificação institucional.
          </p>
        </div>
        <Link
          href="/busca-ativa"
          className="inline-flex items-center space-x-2 bg-white text-sky-800 hover:bg-sky-50 font-bold px-5 py-3 rounded-xl shadow-sm transition whitespace-nowrap"
        >
          <Send className="w-4 h-4" />
          <span>Fazer Novo Envio</span>
        </Link>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total de Alunos</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{totalStudents}</div>
          <div className="text-xs text-slate-500 mt-1">Fundamental, Médio e Noturno</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Mensagens Enviadas</div>
          <div className="text-2xl font-bold text-sky-600 mt-1">{totalLogs.toLocaleString()}</div>
          <div className="text-xs text-slate-500 mt-1">Histórico completo migrado</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Retornos Confirmados</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">{totalReplied}</div>
          <div className="text-xs text-slate-500 mt-1">Respostas dos responsáveis</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Busca Ativa / CT</div>
          <div className="text-2xl font-bold text-amber-600 mt-1">{lowAttendanceCount}</div>
          <div className="text-xs text-slate-500 mt-1">Alunos em acompanhamento</div>
        </div>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.href}
              className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs hover:shadow-md transition flex flex-col justify-between"
            >
              <div>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center border mb-4 ${card.color}`}>
                  <Icon className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">{card.title}</h3>
                <p className="text-sm text-slate-600 mt-2 leading-relaxed">{card.desc}</p>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-100">
                <Link
                  href={card.href}
                  className="inline-flex items-center text-sm font-semibold text-sky-600 hover:text-sky-800 transition group"
                >
                  <span>{card.btnText}</span>
                  <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent Activity Table */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <Clock className="w-4 h-4 text-sky-600" />
            <span>Últimos Envios Registrados</span>
          </h2>
          <Link href="/historico" className="text-xs font-semibold text-sky-600 hover:text-sky-800">
            Ver todos ({totalLogs}) &rarr;
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 bg-slate-50 uppercase">
              <tr>
                <th className="px-4 py-2.5 rounded-l-lg">Aluno</th>
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
                  <td className="px-4 py-3 font-medium text-slate-900">{log.student.name}</td>
                  <td className="px-4 py-3 text-slate-600">{log.student.classGroup.name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-50 text-sky-700 border border-sky-100">
                      {log.reasonTitle}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{log.sentByName}</td>
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
