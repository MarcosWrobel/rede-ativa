"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidthClass?: string;
}

export default function AtaDialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  maxWidthClass = "max-w-[98vw] 2xl:max-w-[1560px]",
}: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [isOpen]);

  // Fallback para browsers sem suporte a closedby="any"
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleBackdropClick = (e: MouseEvent) => {
      if (e.target === dialog) {
        const rect = dialog.getBoundingClientRect();
        const isInside =
          rect.top <= e.clientY &&
          e.clientY <= rect.top + rect.height &&
          rect.left <= e.clientX &&
          e.clientX <= rect.left + rect.width;
        if (!isInside) {
          onClose();
        }
      }
    };

    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };

    dialog.addEventListener("click", handleBackdropClick);
    dialog.addEventListener("cancel", handleCancel);
    return () => {
      dialog.removeEventListener("click", handleBackdropClick);
      dialog.removeEventListener("cancel", handleCancel);
    };
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="dialog-title"
      className={`dialog-ata p-0 bg-transparent backdrop:bg-slate-900/60 backdrop:backdrop-blur-xs overscroll-contain w-[98vw] ${maxWidthClass} mx-auto my-auto rounded-3xl shadow-2xl open:animate-in open:fade-in open:zoom-in-95 border border-slate-200/80 focus:outline-none`}
      style={{ maxWidth: "min(98vw, 1560px)", width: "98vw" }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-3xl overflow-hidden flex flex-col max-h-[96vh] w-full border border-slate-200 dark:border-slate-800">
        {/* Cabeçalho */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-900">
          <div>
            <h2 id="dialog-title" className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
              {title}
            </h2>
            {description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo com scroll */}
        <div className="p-5 lg:p-7 overflow-y-auto flex-1 space-y-6">{children}</div>
      </div>
    </dialog>
  );
}
