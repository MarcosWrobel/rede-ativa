"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Eraser, Check, X } from "lucide-react";

interface StrokePoint {
  x: number;
  y: number;
  t: number;
  p: number;
  stroke: number;
}

interface Props {
  onSave?: (dataUrl: string, strokeData?: string) => void | Promise<void>;
  onStrokeChange?: (dataUrl: string | null, strokeData?: string) => void;
  onClear?: () => void;
  onCancel?: () => void;
  initialDataUrl?: string | null;
  signerName: string;
  revisionLabel?: string | null;
  isSubmitting?: boolean;
  showConfirmButton?: boolean;
}

export default function SignatureCanvas({
  onSave,
  onStrokeChange,
  onClear,
  onCancel,
  initialDataUrl,
  signerName,
  revisionLabel = null,
  isSubmitting = false,
  showConfirmButton = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<StrokePoint[]>([]);
  const strokeIndexRef = useRef(0);
  const isDrawingRef = useRef(false);
  const localConfirmLockRef = useRef(false);
  const lastSizeRef = useRef<{ width: number; height: number; dpr: number } | null>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [hasContent, setHasContent] = useState(Boolean(initialDataUrl));
  const [strokeCount, setStrokeCount] = useState(0);
  const [localSubmitting, setLocalSubmitting] = useState(false);

  const effectiveSubmitting = Boolean(isSubmitting || localSubmitting);

  const redrawStoredStrokes = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (initialDataUrl && strokesRef.current.length === 0) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, width, height);
        };
        img.src = initialDataUrl;
        return;
      }

      let currentStrokeId: number | null = null;
      for (const pt of strokesRef.current) {
        if (currentStrokeId !== pt.stroke) {
          if (currentStrokeId !== null) {
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.moveTo(pt.x, pt.y);
          ctx.lineTo(pt.x + 0.1, pt.y + 0.1);
          currentStrokeId = pt.stroke;
        } else {
          ctx.lineTo(pt.x, pt.y);
        }
      }
      if (currentStrokeId !== null) {
        ctx.stroke();
      }
    },
    [initialDataUrl]
  );

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const prev = lastSizeRef.current;
    if (
      prev &&
      Math.abs(prev.width - rect.width) < 0.5 &&
      Math.abs(prev.height - rect.height) < 0.5 &&
      prev.dpr === dpr
    ) {
      return;
    }

    lastSizeRef.current = { width: rect.width, height: rect.height, dpr };
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    redrawStoredStrokes(ctx, rect.width, rect.height);
  }, [redrawStoredStrokes]);

  useEffect(() => {
    setupCanvas();
    window.addEventListener("resize", setupCanvas);
    return () => window.removeEventListener("resize", setupCanvas);
  }, [setupCanvas]);

  const getCoordinates = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (effectiveSubmitting) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Ambientes sintéticos ou touch sem pointer ativo podem ignorar setPointerCapture
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCoordinates(e);

    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    strokeIndexRef.current += 1;
    const strokeId = strokeIndexRef.current;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);

    isDrawingRef.current = true;
    setIsDrawing(true);
    setHasContent(true);

    strokesRef.current.push({
      x: Math.round(x),
      y: Math.round(y),
      t: Date.now(),
      p: Number((e.pressure || 0.5).toFixed(2)),
      stroke: strokeId,
    });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || effectiveSubmitting) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCoordinates(e);

    ctx.lineTo(x, y);
    ctx.stroke();

    strokesRef.current.push({
      x: Math.round(x),
      y: Math.round(y),
      t: Date.now(),
      p: Number((e.pressure || 0.5).toFixed(2)),
      stroke: strokeIndexRef.current,
    });
  };

  // Levantar o dedo ou a caneta encerra apenas o traço atual; nunca confirma a assinatura automaticamente
  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    isDrawingRef.current = false;
    setIsDrawing(false);

    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Ignora se já tiver liberado
    }

    setStrokeCount((prev) => prev + 1);
    if (onStrokeChange) {
      const dataUrl = canvas.toDataURL("image/png");
      const strokeData =
        strokesRef.current.length > 0 ? JSON.stringify(strokesRef.current) : undefined;
      onStrokeChange(dataUrl, strokeData);
    }
  };

  const handleClear = () => {
    if (effectiveSubmitting) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width || canvas.width, rect.height || canvas.height);
    strokesRef.current = [];
    strokeIndexRef.current = 0;
    isDrawingRef.current = false;
    setIsDrawing(false);
    setHasContent(false);
    setStrokeCount(0);
    onClear?.();
    onStrokeChange?.(null, undefined);
  };

  const handleCancel = () => {
    if (effectiveSubmitting) return;
    onCancel?.();
  };

  const handleConfirm = async () => {
    if (!hasContent || effectiveSubmitting || localConfirmLockRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas || !onSave) return;

    localConfirmLockRef.current = true;
    setLocalSubmitting(true);
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const strokeData =
        strokesRef.current.length > 0 ? JSON.stringify(strokesRef.current) : undefined;
      await onSave(dataUrl, strokeData);
    } finally {
      localConfirmLockRef.current = false;
      setLocalSubmitting(false);
    }
  };

  return (
    <div className="space-y-2.5" data-testid="signature-canvas-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-bold text-slate-700">
          Assinatura em Tela: <strong className="text-slate-900">{signerName}</strong>
          {revisionLabel ? (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold">
              {revisionLabel}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={handleClear}
          disabled={effectiveSubmitting}
          className="inline-flex items-center space-x-1 text-slate-500 hover:text-rose-600 transition font-medium cursor-pointer disabled:opacity-40"
        >
          <Eraser className="w-3.5 h-3.5" />
          <span>Limpar traço</span>
        </button>
      </div>

      <div className="relative border-2 border-dashed border-slate-300 rounded-xl bg-slate-50/50 touch-none overflow-hidden">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          className="w-full h-36 cursor-crosshair block"
          style={{ touchAction: "none" }}
        />
        {!hasContent && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-400 text-xs font-medium text-center px-3">
            Assine aqui com o dedo, caneta stylus ou mouse
          </div>
        )}
      </div>

      {hasContent && (
        <p className="text-[11px] text-emerald-700 font-medium flex items-center space-x-1">
          <Check className="w-3.5 h-3.5 shrink-0" />
          <span>
            {showConfirmButton
              ? `${strokeCount > 0 ? `${strokeCount} traço(s) desenhado(s)` : "Desenho capturado"} — continue escrevendo ou acione Confirmar assinatura.`
              : "Traço desenhado — finalize no botão abaixo para gravar."}
          </span>
        </p>
      )}

      {showConfirmButton && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <span className="text-[11px] text-slate-500">
            Levante o dedo ou a caneta livremente entre traços.
          </span>
          <div className="flex items-center space-x-2">
            {onCancel && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={effectiveSubmitting}
                className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs transition cursor-pointer disabled:opacity-40"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancelar</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={!hasContent || effectiveSubmitting}
              className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-2xs transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{effectiveSubmitting ? "Registrando..." : "Confirmar assinatura"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
