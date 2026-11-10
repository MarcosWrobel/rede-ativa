"use client";

import { UserPlus, Trash2 } from "lucide-react";
import type { AtaActionItemDraft } from "./types";

export interface AtaActionItemsSectionProps {
  actionItems: AtaActionItemDraft[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<AtaActionItemDraft>) => void;
  onRemove: (index: number) => void;
}

/**
 * Seção de listagem, adição e remoção de encaminhamentos e prazos pactuados
 * no rascunho da ata pedagógica.
 */
export default function AtaActionItemsSection({
  actionItems,
  onAdd,
  onUpdate,
  onRemove,
}: AtaActionItemsSectionProps) {
  return (
    <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 shadow-2xs">
      <div className="flex items-center justify-between">
        <h4 className="font-extrabold text-slate-800 block text-xs">
          Encaminhamentos e Prazos:
        </h4>
        <button
          type="button"
          onClick={onAdd}
          aria-label="Novo Encaminhamento e prazo"
          className="text-sky-600 hover:text-sky-700 font-bold flex items-center space-x-1 cursor-pointer text-xs px-2.5 py-1 bg-white border border-slate-200 rounded-lg shadow-2xs"
        >
          <UserPlus aria-hidden="true" className="w-3.5 h-3.5" />
          <span>Novo Encaminhamento</span>
        </button>
      </div>

      {actionItems.length === 0 ? (
        <div className="text-center py-3 text-slate-400 text-xs italic">
          Nenhum encaminhamento registrado.
        </div>
      ) : (
        <ul className="space-y-2">
          {actionItems.map((act, idx) => (
            <li
              key={act.id || idx}
              className="flex items-center space-x-2 bg-white p-2 rounded-xl border border-slate-200 shadow-2xs"
            >
              <input
                type="text"
                aria-label={`Descrição do encaminhamento ${idx + 1}`}
                placeholder="Descrição da ação pactuada..."
                value={act.description}
                onChange={(e) => onUpdate(idx, { description: e.target.value })}
                className="flex-1 p-1.5 border border-slate-300 rounded-lg bg-white text-xs"
              />
              <select
                aria-label={`Responsável pelo encaminhamento ${idx + 1}`}
                value={act.responsible}
                onChange={(e) => onUpdate(idx, { responsible: e.target.value })}
                className="p-1.5 border border-slate-300 rounded-lg bg-white font-semibold text-xs"
              >
                <option value="FAMILIA">Família</option>
                <option value="ESTUDANTE">Estudante</option>
                <option value="ESCOLA">Escola</option>
                <option value="REDE_PROTECAO">Rede / CT</option>
              </select>
              <input
                type="date"
                aria-label={`Prazo do encaminhamento ${idx + 1}`}
                value={act.dueDate}
                onChange={(e) => onUpdate(idx, { dueDate: e.target.value })}
                className="p-1.5 border border-slate-300 rounded-lg bg-white text-xs"
              />
              <button
                type="button"
                onClick={() => onRemove(idx)}
                aria-label={`Remover encaminhamento ${idx + 1}`}
                className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
              >
                <Trash2 aria-hidden="true" className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
