"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  size?: "md" | "xl";
  preventClose?: boolean;
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
  preventClose = false,
  children,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const titleId = useId();
  const subtitleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    let focusRaf = 0;

    if (open) {
      if (!wasOpenRef.current) {
        triggerRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      wasOpenRef.current = true;

      if (!dialog.open && typeof dialog.showModal === "function") {
        dialog.showModal();
      }

      focusRaf = window.requestAnimationFrame(() => {
        if (!dialog.open) return;
        const active = document.activeElement;
        if (active && dialog.contains(active) && active !== dialog) {
          return;
        }
        const preferred = dialog.querySelector<HTMLElement>(
          "[data-autofocus], [autofocus]"
        );
        const firstField = dialog.querySelector<HTMLElement>(
          'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)'
        );
        const firstInteractive = dialog.querySelector<HTMLElement>(
          'button:not(:disabled):not([data-dialog-close]), [href], [tabindex]:not([tabindex="-1"])'
        );
        const closeBtn = dialog.querySelector<HTMLElement>("[data-dialog-close]");
        const target = preferred || firstField || firstInteractive || closeBtn;
        target?.focus({ preventScroll: true });
      });
    } else {
      if (dialog.open && typeof dialog.close === "function") {
        dialog.close();
      }
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        const trigger = triggerRef.current;
        if (trigger && trigger.isConnected) {
          const restoreFocus = () => {
            if (
              trigger.isConnected &&
              (!document.activeElement ||
                document.activeElement === document.body ||
                dialog.contains(document.activeElement))
            ) {
              trigger.focus({ preventScroll: true });
            }
          };
          restoreFocus();
          focusRaf = window.requestAnimationFrame(restoreFocus);
        }
      }
    }

    return () => {
      if (focusRaf) window.cancelAnimationFrame(focusRaf);
    };
  }, [open]);

  useEffect(() => {
    return () => {
      const trigger = triggerRef.current;
      if (wasOpenRef.current && trigger && trigger.isConnected) {
        window.requestAnimationFrame(() => {
          if (!dialogRef.current?.isConnected && trigger.isConnected) {
            trigger.focus({ preventScroll: true });
          }
        });
      }
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (event: Event) => {
      if (preventClose) {
        event.preventDefault();
      }
    };

    const handleClose = () => {
      if (open) {
        onClose();
      }
    };

    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);

    // Fallback para navegadores sem suporte nativo a <dialog closedby="any"> (ex: Safari)
    let handlePointerDown: ((event: PointerEvent) => void) | null = null;
    let handlePointerUp: ((event: PointerEvent) => void) | null = null;

    if (
      typeof HTMLDialogElement !== "undefined" &&
      !("closedBy" in HTMLDialogElement.prototype)
    ) {
      let pressedOutside = false;
      const isOutsideContent = (event: PointerEvent) => {
        const target = contentRef.current || dialog;
        const rect = target.getBoundingClientRect();
        return (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        );
      };

      handlePointerDown = (event: PointerEvent) => {
        if (preventClose) {
          pressedOutside = false;
          return;
        }
        pressedOutside = isOutsideContent(event);
      };

      handlePointerUp = (event: PointerEvent) => {
        if (preventClose || !pressedOutside) return;
        pressedOutside = false;
        if (isOutsideContent(event)) {
          dialog.close();
        }
      };

      dialog.addEventListener("pointerdown", handlePointerDown);
      dialog.addEventListener("pointerup", handlePointerUp);
    }

    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
      if (handlePointerDown) {
        dialog.removeEventListener("pointerdown", handlePointerDown);
      }
      if (handlePointerUp) {
        dialog.removeEventListener("pointerup", handlePointerUp);
      }
    };
  }, [onClose, open, preventClose]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      className={size === "xl" ? "dialog-xl" : undefined}
      {...({ closedby: preventClose ? "none" : "any" } as any)}
    >
      <div
        ref={contentRef}
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-4 sm:p-6 space-y-4 text-slate-900 dark:text-slate-100 max-h-[90dvh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold text-slate-900 dark:text-white">
              {title}
            </h2>
            {subtitle && (
              <p id={subtitleId} className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            data-dialog-close
            disabled={preventClose}
            onClick={() => {
              if (!preventClose) {
                dialogRef.current?.close();
              }
            }}
            aria-label="Fechar"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {children}
      </div>
    </dialog>
  );
}
