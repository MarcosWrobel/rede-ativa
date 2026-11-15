"use client";

import { useEffect, useState } from "react";
import {
  EXPECTED_EXTENSION_VERSION,
  getInstalledExtensionVersion,
  getWhatsAppDispatchPreference,
  setWhatsAppDispatchPreference,
  isExtensionActive,
  type WhatsAppDispatchMode,
} from "@/lib/clientDispatcher";
import { Zap, ExternalLink, Check, Info, AlertTriangle } from "lucide-react";

interface Props {
  className?: string;
  compact?: boolean;
}

export default function WhatsAppDispatchToggle({ className = "", compact = false }: Props) {
  const [mode, setMode] = useState<WhatsAppDispatchMode>("extension");
  const [hasExtension, setHasExtension] = useState<boolean>(false);
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => {
    setMounted(true);
    setMode(getWhatsAppDispatchPreference());
    setHasExtension(isExtensionActive());
    setInstalledVersion(getInstalledExtensionVersion());

    const handlePreferenceChanged = (e: Event) => {
      const customEvent = e as CustomEvent<WhatsAppDispatchMode>;
      if (customEvent.detail) setMode(customEvent.detail);
    };

    const handleWindowMessage = (event: MessageEvent) => {
      if (event.source !== undefined && event.source !== window) return;
      if (
        event.origin &&
        event.origin !== "null" &&
        event.origin !== window.location.origin
      ) {
        return;
      }
      if (
        event.data?.type === "REDEATIVA_EXTENSION_READY" ||
        event.data?.type === "LEOPOLDINA_EXTENSION_READY"
      ) {
        setHasExtension(true);
        const ver =
          typeof event.data?.version === "string" && event.data.version.trim()
            ? event.data.version.trim()
            : getInstalledExtensionVersion();
        if (ver) setInstalledVersion(ver);
      }
    };

    window.addEventListener("redeativa_whatsapp_preference_changed", handlePreferenceChanged);
    window.addEventListener("leopoldina_whatsapp_preference_changed", handlePreferenceChanged);
    window.addEventListener("message", handleWindowMessage);

    return () => {
      window.removeEventListener("redeativa_whatsapp_preference_changed", handlePreferenceChanged);
      window.removeEventListener("leopoldina_whatsapp_preference_changed", handlePreferenceChanged);
      window.removeEventListener("message", handleWindowMessage);
    };
  }, []);

  if (!mounted) return null;

  const toggleMode = () => {
    const nextMode: WhatsAppDispatchMode = mode === "extension" ? "native" : "extension";
    setWhatsAppDispatchPreference(nextMode);
    setMode(nextMode);
  };

  const isVersionCurrent =
    hasExtension && installedVersion === EXPECTED_EXTENSION_VERSION;
  const compactExtensionWarning =
    mode === "extension" && (!hasExtension || !isVersionCurrent);

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggleMode}
        title={
          mode !== "extension"
            ? "Disparo em nova aba. Clique para alternar."
            : !hasExtension
            ? `Extensão não detectada nesta aba (esperada v${EXPECTED_EXTENSION_VERSION}). Recarregue a página ou clique para alternar.`
            : !isVersionCurrent
            ? `Extensão v${installedVersion || "?"} desatualizada (esperada v${EXPECTED_EXTENSION_VERSION}). Atualize em chrome://extensions.`
            : `Extensão v${installedVersion} ativa nesta aba. Clique para alternar.`
        }
        className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border transition cursor-pointer shadow-2xs ${
          mode === "extension"
            ? compactExtensionWarning
              ? "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100"
              : "bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100"
            : "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200"
        } ${className}`}
      >
        {mode === "extension" ? (
          <>
            {compactExtensionWarning ? (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            ) : (
              <Zap className="w-3.5 h-3.5 text-emerald-600 fill-emerald-600" />
            )}
            <span>
              {!hasExtension
                ? "Extensão (F5)"
                : !isVersionCurrent
                ? `Extensão v${installedVersion || "?"} ≠ v${EXPECTED_EXTENSION_VERSION}`
                : `Extensão v${installedVersion}`}
            </span>
          </>
        ) : (
          <>
            <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
            <span>Nova aba</span>
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
        title="Abre o WhatsApp na janela da extensão"
      >
        <Zap className="w-3.5 h-3.5" />
        <span>Extensão</span>
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
        title="Abre o WhatsApp em nova aba"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        <span>Nova aba</span>
      </button>
    </div>
  );
}
