"use client";

import { useEffect, useState } from "react";
import { generateQrCodeSvg, generateQrCodeDataUrl } from "@/lib/qrCode";
import { AlertCircle } from "lucide-react";

interface AtaQrCodeProps {
  value: string;
  size?: number;
  className?: string;
  alt?: string;
  initialSvg?: string;
}

/**
 * Componente de alta fidelidade para renderização autônoma de QR Code.
 * - Utiliza SVG vetorial direto (resolução infinita na impressão física A4).
 * - Zero dependências externas de APIs terceiras (imune a bloqueios de firewall, redes públicas ou AdBlockers).
 * - Suporta pré-renderização server-side (SSR) para exibição imediata ao imprimir.
 */
export default function AtaQrCode({
  value,
  size = 180,
  className = "",
  alt = "QR Code de Validação Pública",
  initialSvg,
}: AtaQrCodeProps) {
  const [svgMarkup, setSvgMarkup] = useState<string | null>(initialSvg || null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!value || typeof value !== "string" || value.trim() === "") {
      setSvgMarkup(null);
      setDataUrl(null);
      return;
    }

    let isMounted = true;

    // 1. Gera SVG localmente (vetorial, ultra-rápido, sem chamadas de rede)
    generateQrCodeSvg(value, {
      margin: 1,
      width: size,
      errorCorrectionLevel: "M",
    })
      .then((svg) => {
        if (isMounted) {
          setSvgMarkup(svg);
          setHasError(false);
        }
      })
      .catch(async () => {
        // 2. Fallback local: gera Data URL PNG localmente
        try {
          const url = await generateQrCodeDataUrl(value, {
            margin: 1,
            width: size,
            errorCorrectionLevel: "M",
          });
          if (isMounted) {
            setDataUrl(url);
            setHasError(false);
          }
        } catch {
          // 3. Fallback final: endpoint interno seguro do próprio SaaS
          if (isMounted) {
            setDataUrl(`/api/atas/qr?data=${encodeURIComponent(value)}&size=${size}&format=png`);
            setHasError(false);
          }
        }
      });

    return () => {
      isMounted = false;
    };
  }, [value, size]);

  if (!value || value.trim() === "") {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex flex-col items-center justify-center bg-slate-50 text-slate-400 p-2 text-center rounded-xl border border-dashed border-slate-200 ${className}`}
        title="Código de autenticação pendente"
      >
        <AlertCircle className="w-5 h-5 text-amber-500 mb-1" />
        <span className="text-[10px] font-bold leading-tight">Código Indisponível</span>
      </div>
    );
  }

  if (hasError) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex flex-col items-center justify-center bg-rose-50 text-rose-600 p-2 text-center rounded-xl border border-rose-200 ${className}`}
      >
        <AlertCircle className="w-5 h-5 mb-1" />
        <span className="text-[10px] font-bold leading-tight">Erro no QR Code</span>
      </div>
    );
  }

  if (svgMarkup) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`inline-flex items-center justify-center select-none [&>svg]:w-full [&>svg]:h-full [&>svg]:block print:p-0 ${className}`}
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
        role="img"
        aria-label={alt}
      />
    );
  }

  if (dataUrl) {
    return (
      <img
        src={dataUrl}
        alt={alt}
        style={{ width: size, height: size }}
        className={`inline-block select-none object-contain print:p-0 ${className}`}
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size }}
      className={`animate-pulse bg-slate-100 rounded-xl flex items-center justify-center text-slate-300 ${className}`}
      aria-label="Carregando QR Code..."
    >
      <div className="w-6 h-6 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
