"use client";

import { useState, useRef, useEffect } from "react";
import { Building2, ChevronDown, Check, Plus, Settings, Landmark, ShieldCheck } from "lucide-react";

interface SchoolOption {
  schoolId: string;
  name: string;
  inepCode: string;
  city?: string;
  network?: string;
  role?: string;
  logoUrl?: string | null;
}

interface SchoolSelectorProps {
  currentSchool?: {
    id: string;
    name: string;
    inepCode: string;
    city?: string;
    network?: string;
    logoUrl?: string | null;
  } | null;
  userSchools?: SchoolOption[];
  isAdmin?: boolean;
}

export default function SchoolSelector({
  currentSchool,
  userSchools = [],
  isAdmin = false,
}: SchoolSelectorProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fecha o dropdown ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectSchool = async (schoolId: string) => {
    if (schoolId === currentSchool?.id || loading) return;

    setLoading(true);
    try {
      const res = await fetch("/api/auth/switch-school", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Erro ao alternar instituição");
        setLoading(false);
        return;
      }

      // Recarrega a página para que todos os Server Components e APIs assumam o novo contexto
      window.location.reload();
    } catch (err: any) {
      console.error("Falha ao alternar escola:", err);
      alert("Erro de conexão ao alternar instituição escolar.");
      setLoading(false);
    }
  };

  const schoolsList = Array.isArray(userSchools) ? userSchools : [];
  const hasMultiple = schoolsList.length > 1 || isAdmin;
  const networkBadge =
    currentSchool?.network === "MUNICIPAL"
      ? "SEMEC"
      : currentSchool?.network === "PRIVADA"
      ? "PRIVADA"
      : "SEED-PR";

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => hasMultiple && setOpen(!open)}
        disabled={!hasMultiple || loading}
        className={`flex items-center space-x-2 text-left px-2.5 py-1.5 rounded-lg border transition ${
          hasMultiple
            ? "bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700/80 border-slate-200 dark:border-slate-700 cursor-pointer"
            : "bg-transparent border-transparent cursor-default"
        }`}
        title={hasMultiple ? "Alternar escola" : undefined}
      >
        <div className="w-6 h-6 rounded-md bg-white dark:bg-slate-700 flex items-center justify-center p-0.5 border border-slate-200 dark:border-slate-600 flex-shrink-0 overflow-hidden">
          {currentSchool?.logoUrl ? (
            <img
              src={currentSchool.logoUrl}
              alt=""
              className="w-full h-full object-contain"
              onError={(e) => {
                // Fallback para ícone se a imagem falhar
                (e.target as HTMLElement).style.display = "none";
              }}
            />
          ) : (
            <Landmark className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          )}
        </div>

        <div className="flex flex-col min-w-0 pr-1">
          <div className="flex items-center space-x-1.5">
            <span className="font-bold text-xs text-slate-800 dark:text-slate-100 truncate max-w-[140px] sm:max-w-[200px] md:max-w-[260px]">
              {currentSchool?.name || "Colégio Estadual"}
            </span>
            <span
              className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase tracking-wider ${
                currentSchool?.network === "MUNICIPAL"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                  : "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300"
              }`}
            >
              {networkBadge}
            </span>
          </div>
          {currentSchool?.city && (
            <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
              {currentSchool.city} • INEP: {currentSchool.inepCode}
            </span>
          )}
        </div>

        {hasMultiple && (
          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {/* Dropdown Menu */}
      {open && (
        <div className="absolute left-0 mt-1.5 w-72 sm:w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700/80">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
              Suas escolas
            </span>
          </div>

          <div className="max-h-64 overflow-y-auto p-1.5 space-y-1">
            {schoolsList.map((item) => {
              const isSelected = item.schoolId === currentSchool?.id;
              return (
                <button
                  key={item.schoolId}
                  type="button"
                  onClick={() => {
                    handleSelectSchool(item.schoolId);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between p-2 rounded-lg text-left text-xs transition ${
                    isSelected
                      ? "bg-sky-50 dark:bg-sky-950/40 text-sky-900 dark:text-sky-200 font-bold border border-sky-200 dark:border-sky-800"
                      : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                    <div className="w-5 h-5 rounded bg-white dark:bg-slate-800 flex items-center justify-center border border-slate-200 dark:border-slate-700 flex-shrink-0 overflow-hidden">
                      {item.logoUrl ? (
                        <img src={item.logoUrl} alt="" className="w-full h-full object-contain" />
                      ) : (
                        <Building2 className="w-3 h-3 text-slate-500" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{item.name}</div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                        <span>INEP: {item.inepCode}</span>
                        {item.role && (
                          <span className="text-[9px] uppercase px-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                            {item.role}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {isSelected && <Check className="w-4 h-4 text-sky-600 dark:text-sky-400 flex-shrink-0" />}
                </button>
              );
            })}
          </div>

          <div className="p-1.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex flex-col gap-1">
            <a
              href="/configuracoes/escola"
              onClick={() => setOpen(false)}
              className="flex items-center space-x-2 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
            >
              <Settings className="w-3.5 h-3.5 text-slate-500" />
              <span>Dados & Identidade da Escola</span>
            </a>

            {isAdmin && (
              <a
                href="/admin/escolas"
                onClick={() => setOpen(false)}
                className="flex items-center space-x-2 px-2.5 py-1.5 text-xs font-semibold text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 rounded-lg transition"
              >
                <Plus className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                <span>Cadastrar Nova Instituição</span>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
