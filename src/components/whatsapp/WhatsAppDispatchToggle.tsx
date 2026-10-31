"use client";

import { useEffect, useState } from "react";
import {
  getWhatsAppDispatchPreference,
  setWhatsAppDispatchPreference,
  isExtensionActive,
  type WhatsAppDispatchMode,
} from "@/lib/clientDispatcher";
import { Zap, ExternalLink, Check, Info } from "lucide-react";

interface Props {
  className?: string;
  compact?: boolean;
}

export default function WhatsAppDispatchToggle({ className = "", compact = false }: Props) {
  const [mode, setMode] = useState<WhatsAppDispatchMode>("extension");
  const [hasExtension, setHasExtension] = useState<boolean>(false);
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => {
    setMounted(true);
    setMode(getWhatsAppDispatchPreference());
    setHasExtension(isExtensionActive());

    const handlePreferenceChanged = (e: any) => {
      if (e?.detail) setMode(e.detail);
    };

    const handleExtensionReady = () => {
      setHasExtension(true);
    };

    window.addEventListener("leopoldina_whatsapp_preference_changed", handlePreferenceChanged);
    window.addEventListener("message", (event) => {
      if (event.data?.type === "LEOPOLDINA_EXTENSION_READY") {
        setHasExtension(true);
      }
    });

    return () => {
      window.removeEventListener("leopoldina_whatsapp_preference_changed", handlePreferenceChanged);
    };
  }, []);

  if (!mounted) return null;

  const toggleMode = () => {
    const nextMode: WhatsAppDispatchMode = mode === "extension" ? "native" : "extension";
    setWhatsAppDispatchPreference(nextMode);
    setMode(nextMode);
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggleMode}
        title={
          mode === "extension"
            ? "Modo Ativo: Janela Dedicada Compacta via Extensão. Clique para alternar para o Modo Convencional."
            : "Modo Ativo: Convencional (Nova Aba). Clique para alternar para o Modo Janela Dedicada."
        }
        className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border transition cursor-pointer shadow-2xs ${
          mode === "extension"
            ? "bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100"
            : "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200"
        } ${className}`}
      >
        {mode === "extension" ? (
          <>
            <Zap className="w-3.5 h-3.5 text-emerald-600 fill-emerald-600" />
            <span>Janela Compacta (Extensão)</span>
          </>
        ) : (
          <>
            <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
            <span>Convencional (Nova Aba)</span>
          </>
        )}
      </button>
    );
  }

  return (
    <div
      className={`inline-flex items-center space-x-2 bg-white border border-slate-200 rounded-xl p-1 shadow-2xs ${className}`}
    >
      <button
        type="button"
        onClick={() => {
          setWhatsAppDispatchPreference("extension");
          setMode("extension");
        }}
        className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
          mode === "extension"
            ? "bg-emerald-600 text-white shadow-xs"
            : "text-slate-600 hover:bg-slate-100"
        }`}
        title="Abre e reutiliza a Janela Dedicada Compacta do WhatsApp Web sem barras de navegação"
      >
        <Zap className="w-3.5 h-3.5" />
        <span>Janela Dedicada (Extensão)</span>
      </button>

      <button
        type="button"
        onClick={() => {
          setWhatsAppDispatchPreference("native");
          setMode("native");
        }}
        className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
          mode === "native"
            ? "bg-slate-800 text-white shadow-xs"
            : "text-slate-600 hover:bg-slate-100"
        }`}
        title="Abre o WhatsApp Web pelo método tradicional do navegador"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        <span>Convencional (Nova Aba)</span>
      </button>
    </div>
  );
}
