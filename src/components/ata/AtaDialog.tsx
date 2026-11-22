"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidthClass?: string;
  hasActiveChildModal?: boolean;
}

export default function AtaDialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  maxWidthClass = "max-w-[98vw] 2xl:max-w-[1560px]",
  hasActiveChildModal = false,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    let focusRaf = 0;

    if (isOpen) {
      if (!wasOpenRef.current) {
        triggerRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      wasOpenRef.current = true;

      if (!dialog.open && typeof dialog.showModal === "function") {
        dialog.showModal();
      }

      focusRaf = window.requestAnimationFrame(() => {
        if (!dialog.open || hasActiveChildModal) return;
        const active = document.activeElement;
        if (active && dialog.contains(active) && active !== dialog) {
          return;
        }
        const preferred = dialog.querySelector<HTMLElement>(
          "[data-autofocus], [autofocus]"
        );
        const firstInteractive = dialog.querySelector<HTMLElement>(
          'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled):not([data-ata-dialog-close])'
        );
        const closeBtn = dialog.querySelector<HTMLElement>("[data-ata-dialog-close]");
        const target = preferred || firstInteractive || closeBtn;
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
  }, [isOpen, hasActiveChildModal]);

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

  // Controle de Escape e light-dismiss respeitando diálogos filhos abertos
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    let pressedOutside = false;
    const isOutsideContent = (e: PointerEvent) => {
      const target = contentRef.current || dialog;
      const rect = target.getBoundingClientRect();
      return (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      );
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (hasActiveChildModal) {
        pressedOutside = false;
        return;
      }
      pressedOutside = isOutsideContent(e);
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (hasActiveChildModal || !pressedOutside) return;
      pressedOutside = false;
      if (isOutsideContent(e)) {
        onClose();
      }
    };

    const handleCancel = (e: Event) => {
      e.preventDefault();
      if (!hasActiveChildModal) {
        onClose();
      }
    };

    dialog.addEventListener("pointerdown", handlePointerDown);
    dialog.addEventListener("pointerup", handlePointerUp);
    dialog.addEventListener("cancel", handleCancel);
    return () => {
      dialog.removeEventListener("pointerdown", handlePointerDown);
      dialog.removeEventListener("pointerup", handlePointerUp);
      dialog.removeEventListener("cancel", handleCancel);
    };
  }, [onClose, hasActiveChildModal]);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      {...({ closedby: hasActiveChildModal ? "none" : "any" } as any)}
      className={`dialog-ata p-0 bg-transparent backdrop:bg-slate-900/60 backdrop:backdrop-blur-xs overscroll-contain w-[98vw] ${maxWidthClass} mx-auto my-auto rounded-3xl shadow-2xl open:animate-in open:fade-in open:zoom-in-95 border border-slate-200 dark:border-slate-800 focus:outline-none`}
      style={{ maxWidth: "min(98vw, 1560px)", width: "98vw" }}
    >
      <div
        ref={contentRef}
        className="bg-white dark:bg-slate-900 rounded-3xl overflow-hidden flex flex-col max-h-[96vh] w-full border border-slate-200 dark:border-slate-800"
      >
        {/* Cabeçalho */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900 gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight">
              {title}
            </h2>
            {description && (
              <p id={descId} className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            data-ata-dialog-close
            onClick={onClose}
            className="p-2.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer shrink-0"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo com scroll */}
        <div className="p-4 sm:p-5 lg:p-7 overflow-y-auto flex-1 space-y-6">{children}</div>
      </div>
    </dialog>
  );
}
