"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldAlert, Landmark, ArrowLeft, Building2 } from "lucide-react";

interface ElevationBannerProps {
  currentUser?: {
    role: string;
    email: string;
    name: string;
  } | null;
  currentSchool?: {
    id: string;
    name: string;
    city?: string;
    network?: string;
  } | null;
}

export default function ElevationBanner({ currentUser, currentSchool }: ElevationBannerProps) {
  const pathname = usePathname() || "";

  if (!currentUser) return null;

  const isSuperAdmin = currentUser.role === "SUPERADMIN";
  const isSecretariat = currentUser.role === "GESTAO_SECRETARIA";

  // Não exibe se o usuário for apenas gestor local ou pedagoga
  if (!isSuperAdmin && !isSecretariat) return null;

  // Não exibe quando já estiver em suas próprias homepages executivas
  if (isSuperAdmin && (pathname === "/admin" || pathname.startsWith("/admin/"))) return null;
  if (isSecretariat && pathname === "/secretaria") return null;

  const returnHref = isSuperAdmin ? "/admin" : "/secretaria";
  const returnLabel = isSuperAdmin ? "Voltar ao Painel Global" : "Voltar ao Painel SEMEC";
  const roleBadge = isSuperAdmin ? "MODO SUPER ADMIN" : "GESTÃO DA SECRETARIA";
  const badgeColor = isSuperAdmin
    ? "bg-indigo-600 text-white"
    : "bg-amber-600 text-white";

  return (
    <div className="bg-slate-900 border-b border-indigo-500/30 text-white px-4 py-2 text-xs flex flex-col sm:flex-row items-center justify-between gap-2 shadow-sm sticky top-14 z-20 transition-all">
      <div className="flex items-center space-x-2.5 min-w-0">
        <span className={`px-2 py-0.5 rounded-md font-black text-[10px] tracking-wider uppercase flex items-center space-x-1 ${badgeColor}`}>
          {isSuperAdmin ? <ShieldAlert className="w-3 h-3 mr-1" /> : <Landmark className="w-3 h-3 mr-1" />}
          {roleBadge}
        </span>

        <span className="text-slate-300 truncate">
          Visualizando unidade: <strong className="text-white">{currentSchool?.name || "Escola Ativa"}</strong>
          {currentSchool?.city && <span className="text-slate-400 font-normal"> ({currentSchool.city})</span>}
        </span>
      </div>

      <Link
        href={returnHref}
        className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/20 transition whitespace-nowrap"
      >
        <ArrowLeft className="w-3 h-3" />
        <span>{returnLabel}</span>
      </Link>
    </div>
  );
}
