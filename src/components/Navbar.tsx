"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  Send, 
  History, 
  AlertTriangle, 
  BarChart3, 
  Users, 
  FileText, 
  ShieldCheck, 
  LogOut,
  GraduationCap
} from "lucide-react";

interface NavbarProps {
  currentUser?: {
    name: string;
    email: string;
    role: string;
  } | null;
}

export default function Navbar({ currentUser }: NavbarProps) {
  const pathname = usePathname();

  const navLinks = [
    { href: "/busca-ativa", label: "Painel de Envio", icon: Send },
    { href: "/historico", label: "Histórico de Envios", icon: History },
    { href: "/faltas", label: "Controle de Faltas & Busca Ativa", icon: AlertTriangle },
    { href: "/relatorios", label: "Relatórios & Gráficos", icon: BarChart3 },
    { href: "/alunos", label: "Alunos & Turmas", icon: Users },
    { href: "/modelos", label: "Modelos de Mensagem", icon: FileText },
    { href: "/auditoria", label: "Trilha de Auditoria", icon: ShieldCheck },
  ];

  if (pathname === "/login") return null;

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          {/* Logo & School Name */}
          <div className="flex items-center space-x-3">
            <Link href="/" className="flex items-center space-x-3 group">
              <div className="w-10 h-10 rounded-xl bg-sky-600 text-white flex items-center justify-center font-bold shadow-sm group-hover:bg-sky-700 transition">
                <GraduationCap className="w-6 h-6" />
              </div>
              <div>
                <span className="font-bold text-slate-800 text-lg leading-tight block">
                  Colégio Leopoldina
                </span>
                <span className="text-xs text-sky-600 font-semibold tracking-wider uppercase block">
                  Sistema de Busca Ativa
                </span>
              </div>
            </Link>
          </div>

          {/* Navigation items */}
          <nav className="hidden lg:flex space-x-1">
            {navLinks.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center space-x-1.5 px-3 py-2 rounded-lg text-sm font-medium transition ${
                    isActive
                      ? "bg-sky-50 text-sky-700 font-semibold shadow-xs"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? "text-sky-600" : "text-slate-400"}`} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* User profile & Google Escola indicator */}
          <div className="flex items-center space-x-3">
            {currentUser ? (
              <div className="flex items-center space-x-3">
                <div className="text-right hidden sm:block">
                  <div className="text-sm font-medium text-slate-800 leading-none">
                    {currentUser.name}
                  </div>
                  <div className="text-xs text-sky-600 font-mono mt-1">
                    {currentUser.email}
                  </div>
                </div>
                <div className="w-9 h-9 rounded-full bg-sky-100 text-sky-800 border border-sky-300 flex items-center justify-center font-bold text-sm">
                  {currentUser.name.charAt(0)}
                </div>
                <Link
                  href="/api/auth/signout"
                  title="Sair"
                  className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition"
                >
                  <LogOut className="w-4 h-4" />
                </Link>
              </div>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center justify-center px-4 py-2 border border-sky-600 text-sm font-medium rounded-lg text-sky-700 bg-white hover:bg-sky-50 transition shadow-xs"
              >
                Entrar com @escola
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Mobile sub-bar */}
      <div className="lg:hidden border-t border-slate-100 px-4 py-2 flex overflow-x-auto space-x-2 text-xs">
        {navLinks.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap px-3 py-1.5 rounded-md font-medium transition ${
                isActive ? "bg-sky-600 text-white" : "text-slate-600 bg-slate-100"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}
