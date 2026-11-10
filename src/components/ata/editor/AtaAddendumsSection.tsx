"use client";

import { useId } from "react";
import { FilePlus2 } from "lucide-react";
import type { AtaAddendumRecord } from "./types";

export interface AtaAddendumsSectionProps {
  addendums: AtaAddendumRecord[];
  isVoid: boolean;
  addendumText: string;
  savingAddendum: boolean;
  onAddendumTextChange: (value: string) => void;
  onSubmitAddendum: () => void;
}

/**
 * Seção de consulta da cadeia de Termos Aditivos ("Em tempo") e formulário de
 * lavratura de novo adendo criptográfico em atas oficiais já finalizadas.
 */
export default function AtaAddendumsSection({
  addendums,
  isVoid,
  addendumText,
  savingAddendum,
  onAddendumTextChange,
  onSubmitAddendum,
}: AtaAddendumsSectionProps) {
  const inputId = useId();

  return (
    <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-3">
      <h4 className="font-extrabold text-slate-900 dark:text-white text-sm flex items-center space-x-1.5">
        <FilePlus2 aria-hidden="true" className="w-4 h-4 text-sky-600 dark:text-sky-400" />
        <span>Termos de Aditamento / Retificação (&quot;Em tempo&quot;)</span>
      </h4>

      {addendums.length > 0 ? (
        <ul className="space-y-2.5">
          {addendums.map((add, i) => (
            <li
              key={add.id || i}
              className="p-3 bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl space-y-1"
            >
              <p className="font-serif text-slate-800 dark:text-slate-200 text-xs leading-relaxed">
                <strong>Em tempo ({i + 1}):</strong> {add.content}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                Por {add.authorName} em {new Date(add.createdAt).toLocaleString("pt-BR")} • Hash:{" "}
                {add.addendumHash?.slice(0, 20)}...
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-slate-400 dark:text-slate-500 italic">
          Nenhum termo de aditamento registrado nesta ata.
        </p>
      )}

      {!isVoid && (
        <div className="pt-2 space-y-2 border-t border-slate-100 dark:border-slate-800">
          <label
            htmlFor={inputId}
            className="font-bold text-slate-700 dark:text-slate-300 block"
          >
            Lavrar novo adendo (&quot;Em tempo&quot;) sem alterar o texto original:
          </label>
          <textarea
            id={inputId}
            rows={2}
            value={addendumText}
            onChange={(e) => onAddendumTextChange(e.target.value)}
            placeholder="Ex.: Em tempo, retifica-se o prazo de entrega do atestado médico para o dia..."
            className="w-full p-2.5 border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-950 focus:bg-white dark:focus:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onSubmitAddendum}
              disabled={savingAddendum}
              aria-label="Registrar Termo de Aditamento em tempo"
              className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold transition disabled:opacity-50 cursor-pointer"
            >
              {savingAddendum ? "Registrando adendo..." : "Registrar Termo de Aditamento"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
