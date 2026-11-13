"use client";

import { UserPlus, Trash2 } from "lucide-react";
import type { AtaActionItemDraft } from "./types";

export interface AtaActionItemsSectionProps {
  actionItems: AtaActionItemDraft[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<AtaActionItemDraft>) => void;
  onRemove: (index: number) => void;
  pendingSuggestions?: AtaActionItemDraft[] | null;
  onAcceptPendingSuggestions?: () => void;
  onDiscardPendingSuggestions?: () => void;
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
  pendingSuggestions,
  onAcceptPendingSuggestions,
  onDiscardPendingSuggestions,
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

      {pendingSuggestions && pendingSuggestions.length > 0 && (
        <div
          role="status"
          className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-950 space-y-2"
        >
          <p className="font-bold">
            A formalização sugeriu {pendingSuggestions.length} novo(s) encaminhamento(s), mas você já possui itens registrados.
          </p>
          <p className="text-[11px] text-amber-900">
            Os encaminhamentos e prazos atuais foram preservados. Deseja substituí-los pelas novas sugestões?
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onDiscardPendingSuggestions}
              className="px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-amber-900 font-bold text-[11px] cursor-pointer hover:bg-amber-100 transition"
            >
              Manter atuais
            </button>
            <button
              type="button"
              onClick={onAcceptPendingSuggestions}
              className="px-2.5 py-1 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-bold text-[11px] cursor-pointer transition"
            >
              Substituir pelos sugeridos
            </button>
          </div>
        </div>
      )}

      {actionItems.length === 0 ? (
        <div className="text-center py-3 text-slate-400 text-xs italic">
          Nenhum encaminhamento registrado.
        </div>
      ) : (
        <ul className="space-y-2">
          {actionItems.map((act, idx) => (
            <li
              key={act.id || idx}
              className="flex flex-wrap sm:flex-nowrap items-center gap-2 bg-white p-2 rounded-xl border border-slate-200 shadow-2xs"
            >
              <input
                type="text"
                aria-label={`Descrição do encaminhamento ${idx + 1}`}
                placeholder="Descrição da ação pactuada..."
                value={act.description}
                onChange={(e) => onUpdate(idx, { description: e.target.value })}
                className="flex-1 min-w-[160px] p-1.5 border border-slate-300 rounded-lg bg-white text-xs"
              />
              <select
                aria-label={`Responsável pelo encaminhamento ${idx + 1}`}
                value={act.responsible}
                onChange={(e) => onUpdate(idx, { responsible: e.target.value })}
                className="p-1.5 border border-slate-300 rounded-lg bg-white font-semibold text-xs"
              >
                <option value="FAMILIA">Família</option>
                <option value="ESTUDANTE">Estudante</option>
                <option value="DOCENTE">Docente / Professor</option>
                <option value="ESCOLA">Escola</option>
                <option value="REDE_PROTECAO">Rede / CT</option>
              </select>
              <div className="flex flex-col items-end">
                <input
                  type="date"
                  aria-label={`Prazo do encaminhamento ${idx + 1}`}
                  value={act.dueDate}
                  onChange={(e) => onUpdate(idx, { dueDate: e.target.value })}
                  className="p-1.5 border border-slate-300 rounded-lg bg-white text-xs"
                />
                {!act.dueDate && (
                  <span className="text-[10px] text-slate-500 font-medium mt-0.5">
                    Sem prazo definido
                  </span>
                )}
              </div>
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
