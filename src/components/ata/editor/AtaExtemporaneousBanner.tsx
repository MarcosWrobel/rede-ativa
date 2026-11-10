"use client";

import { useId } from "react";

export interface AtaExtemporaneousBannerProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Alerta visual e campo obrigatório de justificativa administrativa para lavratura
 * extemporânea de atas pedagógicas (> 5 dias úteis após o atendimento).
 */
export default function AtaExtemporaneousBanner({
  value,
  onChange,
}: AtaExtemporaneousBannerProps) {
  const inputId = useId();
  const hintId = useId();

  return (
    <div
      role="status"
      className="p-4 bg-amber-50/90 border border-amber-300 rounded-2xl space-y-2 text-xs shadow-2xs"
    >
      <label
        htmlFor={inputId}
        className="flex items-center space-x-2 text-amber-900 font-black cursor-pointer"
      >
        <span aria-hidden="true" className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
        <span>Lavratura Extemporânea (Atendimento realizado há mais de 5 dias úteis)</span>
      </label>
      <p id={hintId} className="text-amber-800 leading-relaxed font-medium">
        Atendimentos lavrados após 5 dias úteis exigem justificativa administrativa para constar no Livro de Atas:
      </p>
      <textarea
        id={inputId}
        rows={2}
        required
        aria-describedby={hintId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ex: Reunião presencial realizada na data informada, com colheita de assinaturas concluída nesta data pelo comparecimento do responsável à unidade escolar..."
        className="w-full p-2.5 bg-white border border-amber-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-amber-600 focus:ring-1 focus:ring-amber-500"
      />
    </div>
  );
}
