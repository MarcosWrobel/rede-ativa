"use client";

import { useEffect, useState } from "react";
import { GSI_RETURN_COOKIE } from "@/lib/googleGsiMobile";

function isSafeClientReturnPath(rawPath: string | null | undefined): rawPath is string {
  if (!rawPath) return false;
  const trimmed = rawPath.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return false;
  return (
    trimmed.startsWith("/conselho-classe/professor/") ||
    trimmed.startsWith("/conselho-classe/pre-conselho/") ||
    trimmed.startsWith("/conselho-classe/vincular?") ||
    trimmed.startsWith("/conselho-classe/vincular/")
  );
}

export default function GsiReturnFallbackClient() {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    try {
      const saved = window.sessionStorage?.getItem(GSI_RETURN_COOKIE);
      if (isSafeClientReturnPath(saved)) {
        window.sessionStorage?.removeItem(GSI_RETURN_COOKIE);
        const sep = saved.includes("?") ? "&" : "?";
        window.location.replace(`${saved}${sep}gsi_redirect=1`);
        return;
      }
    } catch {
      // ignora erro de sessionStorage
    }
    setMissing(true);
  }, []);

  if (!missing) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-3xl border border-slate-200 shadow-xs text-center space-y-2">
          <h1 className="text-base font-black text-slate-900">Concluindo login...</h1>
          <p className="text-xs text-slate-600">Redirecionando para o painel da turma.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white p-8 rounded-3xl border border-slate-200 shadow-xs text-center space-y-3">
        <h1 className="text-lg font-black text-slate-900">Link incompleto</h1>
        <p className="text-xs text-slate-600 leading-relaxed">
          Abra novamente o link completo compartilhado pela equipe pedagógica da sua escola.
        </p>
      </div>
    </div>
  );
}
