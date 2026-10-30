"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  size?: "md" | "xl";
  children: React.ReactNode;
}

/**
 * Componente nativo <dialog> seguindo os guias modern-web-guidance `dialog` e `light-dismiss-a-dialog`:
 * - Aberto via showModal() (top-layer, contenção de foco nativa, Esc e retorno automático de foco ao invocador)
 * - Sem role="dialog" ou aria-modal redundantes
 * - Suporte declarativo closedby="any" + fallback de light-dismiss por bounding-box para Safari
 */
export default function ModalDialog({
  open,
  onClose,
  title,
  subtitle,
  size = "md",
  children,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      onClose();
    };

    dialog.addEventListener("close", handleClose);

    // Fallback para navegadores sem suporte nativo a <dialog closedby="any"> (ex: Safari)
    let handleBackdropClick: ((event: MouseEvent) => void) | null = null;
    if (typeof HTMLDialogElement !== "undefined" && !("closedBy" in HTMLDialogElement.prototype)) {
      handleBackdropClick = (event: MouseEvent) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;

        if (!isDialogContent) {
          dialog.close();
        }
      };
      dialog.addEventListener("click", handleBackdropClick);
    }

    return () => {
      dialog.removeEventListener("close", handleClose);
      if (handleBackdropClick) {
        dialog.removeEventListener("click", handleBackdropClick);
      }
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className={size === "xl" ? "dialog-xl" : undefined}
      {...({ closedby: "any" } as any)}
    >
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl p-6 space-y-4 text-slate-900 max-h-[88vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <h2 id={titleId} className="text-base font-bold text-slate-900">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Fechar janela"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {children}
      </div>
    </dialog>
  );
}
