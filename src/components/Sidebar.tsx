"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  LogOut,
  GraduationCap,
  ChevronLeft,
  ChevronRight,
  Menu,
  X
} from "lucide-react";

interface SidebarProps {
  currentUser?: {
    name: string;
    email: string;
    role: string;
  } | null;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

export default function Sidebar({ currentUser, mobileOpen, setMobileOpen }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Load user preference for sidebar state
  useEffect(() => {
    const saved = localStorage.getItem("leopoldina_sidebar_collapsed");
    if (saved !== null) {
      setCollapsed(saved === "true");
    }
  }, []);

  const toggleCollapsed = () => {
    const nextState = !collapsed;
    setCollapsed(nextState);
    localStorage.setItem("leopoldina_sidebar_collapsed", String(nextState));
  };

  const userEmail = (currentUser?.email || "").toLowerCase().trim();
  const isAdmin =
    currentUser?.role === "ADMIN" ||
    userEmail === "marcos.wrobel@escola.pr.gov.br";

  const navLinks = [
    { href: "/busca-ativa", label: "Painel de Envio", icon: Send },
    { href: "/historico", label: "Histórico de Envios", icon: History },
    { href: "/faltas", label: "Busca-ativa", icon: AlertTriangle },
    { href: "/relatorios", label: "Relatórios & Gráficos", icon: BarChart3 },
    { href: "/boletim", label: "Boletim Semanal", icon: FileSpreadsheet },
    { href: "/alunos", label: "Alunos & Turmas", icon: Users },
    { href: "/atas", label: "Livro de Atas", icon: BookOpenCheck },
    { href: "/modelos", label: "Modelos de Mensagem", icon: FileText },
    ...(isAdmin
      ? [
          { href: "/equipe", label: "Equipe & Acessos", icon: UserCheck, badge: "ADM" },
          { href: "/auditoria", label: "Trilha de Auditoria", icon: ShieldCheck, badge: "ADM" },
        ]
      : []),
  ];

  if (pathname === "/login") return null;

  return (
    <>
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-xs lg:hidden transition-opacity"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 flex flex-col bg-slate-900 text-slate-100 border-r border-slate-800 transition-all duration-300 ease-in-out ${
          // Desktop Width
          collapsed ? "lg:w-20" : "lg:w-64"
        } ${
          // Mobile translation
          mobileOpen ? "translate-x-0 w-64" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Brand / Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800">
          <Link
            href="/"
            onClick={() => setMobileOpen(false)}
            className="flex items-center space-x-3 overflow-hidden group"
          >
            <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center p-1 flex-shrink-0 shadow-sm border border-slate-700 group-hover:scale-105 transition">
              <img src="/logo.svg" alt="Colégio Leopoldina" className="w-full h-full object-contain" />
            </div>
            {(!collapsed || mobileOpen) && (
              <div className="transition-opacity duration-200">
                <span className="font-bold text-white text-base leading-tight block truncate">
                  Leopoldina
                </span>
                <span className="text-[10px] text-sky-400 font-semibold tracking-wider uppercase block truncate">
                  Busca Ativa
                </span>
              </div>
            )}
          </Link>

          {/* Mobile close button */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 py-4 px-2 space-y-1.5 overflow-y-auto">
          {navLinks.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`relative flex items-center rounded-xl py-3 px-3.5 text-xs font-semibold transition-colors group ${
                  isActive
                    ? "bg-sky-600 text-white shadow-md shadow-sky-900/30 font-bold"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/80"
                }`}
                title={collapsed && !mobileOpen ? item.label : undefined}
              >
                <Icon
                  className={`w-5 h-5 flex-shrink-0 transition ${
                    isActive ? "text-white" : "text-slate-400 group-hover:text-slate-200"
                  }`}
                />

                {(!collapsed || mobileOpen) && (
                  <>
                    <span className="ml-3 truncate">{item.label}</span>
                    {"badge" in item && (
                      <span className="ml-auto text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        {item.badge}
                      </span>
                    )}
                  </>
                )}

                {/* Floating Tooltip when collapsed */}
                {collapsed && !mobileOpen && (
                  <div className="fixed left-20 ml-2 hidden group-hover:flex items-center px-3 py-1.5 bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-xl border border-slate-700 whitespace-nowrap z-50 pointer-events-none">
                    {item.label}
                  </div>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User Info & Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/40">
          {currentUser ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3 overflow-hidden">
                <div className="w-9 h-9 rounded-xl bg-sky-800 text-sky-200 border border-sky-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                  {currentUser.name.charAt(0)}
                </div>
                {(!collapsed || mobileOpen) && (
                  <div className="overflow-hidden">
                    <div className="flex items-center space-x-1.5">
                      <span className="text-xs font-bold text-white truncate">
                        {currentUser.name}
                      </span>
                      {isAdmin && (
                        <span className="text-[9px] font-extrabold px-1 rounded bg-amber-400 text-slate-900 leading-tight">
                          ADM
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-sky-400 font-mono truncate">
                      {currentUser.email}
                    </div>
                  </div>
                )}
              </div>

              {(!collapsed || mobileOpen) && (
                <Link
                  href="/api/auth/signout"
                  title="Sair"
                  className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition"
                >
                  <LogOut className="w-4 h-4" />
                </Link>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className={`w-full flex items-center justify-center p-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition ${
                collapsed && !mobileOpen ? "px-0" : "px-3"
              }`}
            >
              {collapsed && !mobileOpen ? "Login" : "Entrar @escola"}
            </Link>
          )}

          {/* Desktop Collapse / Expand Toggle Button */}
          <div className="hidden lg:flex justify-end pt-3 mt-3 border-t border-slate-800/80">
            <button
              type="button"
              onClick={toggleCollapsed}
              className="w-full flex items-center justify-center p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg text-xs font-medium transition"
              title={collapsed ? "Expandir Menu" : "Recolher Menu"}
            >
              {collapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <div className="flex items-center space-x-1.5 w-full justify-center">
                  <ChevronLeft className="w-4 h-4" />
                  <span className="text-[11px] text-slate-400">Recolher</span>
                </div>
              )}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
