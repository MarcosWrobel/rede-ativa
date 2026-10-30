"use client";

import Link from "next/link";
import { Printer, ArrowLeft, BookOpen, ShieldCheck } from "lucide-react";

interface Props {
  school: any;
  year: number;
  minutes: any[];
}

export default function LivroAnualClient({ school, year, minutes }: Props) {
  const totalAtas = minutes.length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Barra de Ações (Oculta na Impressão) */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between print:hidden">
        <Link
          href="/atas"
          className="inline-flex items-center space-x-1.5 text-xs font-bold text-slate-700 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar ao Livro de Atas</span>
        </Link>

        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold shadow-sm transition cursor-pointer"
        >
          <Printer className="w-4 h-4 text-amber-400" />
          <span>Imprimir / Gerar PDF Consolidado</span>
        </button>
      </div>

      {/* DOCUMENTO DO LIVRO ANUAL */}
      <div className="bg-white p-8 sm:p-12 rounded-3xl border border-slate-200 shadow-sm text-slate-900 font-serif space-y-12 print:border-none print:shadow-none print:p-0 print:m-0">
        {/* TERMO DE ABERTURA */}
        <div className="min-h-[500px] flex flex-col justify-between border-b-2 border-slate-900 pb-10 page-break-after">
          <div className="text-center space-y-2">
            <p className="font-sans text-xs font-bold tracking-wider uppercase text-slate-600">
              Governo do Estado do Paraná • Secretaria de Estado da Educação — SEED-PR
            </p>
            <p className="font-sans text-xs font-bold text-slate-600">
              Núcleo Regional de Educação de {school.nre}
            </p>
            <h1 className="font-sans text-xl font-black uppercase text-slate-900 mt-2">
              {school.name}
            </h1>
            <p className="font-sans text-xs text-slate-500">
              INEP: {school.inepCode} • {school.city} - {school.state}
            </p>
          </div>

          <div className="my-12 text-center space-y-4">
            <BookOpen className="w-16 h-16 text-slate-800 mx-auto" />
            <h2 className="font-sans text-2xl font-black uppercase tracking-tight">
              Livro Oficial de Atas Pedagógicas
            </h2>
            <p className="font-sans text-base font-extrabold text-slate-700">
              Ano Letivo de {year}
            </p>
          </div>

          <div className="space-y-4 text-justify text-sm leading-relaxed border-t border-slate-300 pt-6">
            <h3 className="font-sans text-center font-extrabold uppercase text-xs tracking-wider">
              Termo de Abertura Oficial
            </h3>
            <p>
              Aos 02 dias do mês de fevereiro de {year}, abre-se o presente Livro de Atas do
              Atendimento Pedagógico e Acompanhamento Escolar do <strong>{school.name}</strong>,
              destinado a lavrar eletronicamente todos os registros, atendimentos a familiares,
              deliberações da Equipe Pedagógica e encaminhamentos à Rede de Proteção da Criança
              e do Adolescente, em estrito cumprimento à Lei Federal nº 14.063/2020, ao Estatuto
              da Criança e do Adolescente (Lei nº 8.069/1990) e às normativas vigentes da SEED-PR.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 pt-12 font-sans text-xs text-center">
            <div className="border-t border-slate-800 pt-1">
              <p className="font-bold">Equipe Pedagógica</p>
              <p className="text-[10px] text-slate-500 uppercase">Servidores Públicos</p>
            </div>
            <div className="border-t border-slate-800 pt-1">
              <p className="font-bold">Direção Escolar</p>
              <p className="text-[10px] text-slate-500 uppercase">Colégio Estadual</p>
            </div>
          </div>
        </div>

        {/* ÍNDICE CRONOLÓGICO */}
        <div className="space-y-4 border-b border-slate-200 pb-8 page-break-after">
          <h3 className="font-sans font-black text-sm uppercase tracking-wider text-slate-900 border-b border-slate-900 pb-1">
            Sumário Cronológico das Atas Lavradas ({year})
          </h3>
          <table className="w-full text-xs font-sans border-collapse">
            <thead>
              <tr className="border-b border-slate-300 text-left font-bold text-slate-700">
                <th className="py-2">Nº / Ano</th>
                <th className="py-2">Data</th>
                <th className="py-2">Estudante(s) Vinculado(s)</th>
                <th className="py-2">Assunto / Pauta</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {minutes.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="py-2 font-mono font-bold">
                    {String(m.ataNumber).padStart(3, "0")}/{m.year}
                  </td>
                  <td className="py-2">{new Date(m.attendedAt).toLocaleDateString("pt-BR")}</td>
                  <td className="py-2 font-medium">
                    {m.students?.map((s: any) => s.studentNameSnapshot).join(", ")}
                  </td>
                  <td className="py-2 text-slate-700">{m.subject}</td>
                  <td className="py-2">
                    {m.status === "VOIDED" ? (
                      <span className="text-rose-600 font-bold uppercase text-[10px]">Sem Efeito</span>
                    ) : (
                      <span className="text-emerald-700 font-bold uppercase text-[10px]">Lavrada</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ATAS INTEGRAIS */}
        <div className="space-y-12">
          {minutes.map((m) => (
            <div key={m.id} className="space-y-4 border-b border-slate-300 pb-8 page-break-inside-avoid">
              <div className="flex items-center justify-between border-b border-slate-800 pb-1 font-sans">
                <h4 className="font-extrabold text-sm uppercase">
                  Ata nº {String(m.ataNumber).padStart(3, "0")}/{m.year}
                </h4>
                <span className="text-xs text-slate-600 font-bold">
                  {new Date(m.attendedAt).toLocaleDateString("pt-BR")}
                </span>
              </div>

              <p className="font-sans text-xs font-bold text-slate-800">
                Pauta: {m.subject} • Aluno(s): {m.students?.map((s: any) => s.studentNameSnapshot).join(", ")}
              </p>

              <p className="text-sm leading-relaxed whitespace-pre-line text-justify">
                {m.summary}
              </p>

              {m.agreementsSummary && (
                <div className="font-sans text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  <strong className="block font-bold">Combinados e Prazos:</strong>
                  <p className="mt-0.5">{m.agreementsSummary}</p>
                </div>
              )}

              <div className="font-sans text-[11px] text-slate-500 flex items-center justify-between pt-2">
                <span>Lavrada por: {m.authorName}</span>
                <span className="font-mono text-[9px]">Hash: {m.contentHash?.slice(0, 24)}...</span>
              </div>
            </div>
          ))}
        </div>

        {/* TERMO DE ENCERRAMENTO */}
        <div className="min-h-[400px] flex flex-col justify-between border-t-2 border-slate-900 pt-8">
          <div className="space-y-4 text-justify text-sm leading-relaxed">
            <h3 className="font-sans text-center font-extrabold uppercase text-xs tracking-wider">
              Termo de Encerramento Oficial
            </h3>
            <p>
              Aos 22 dias do mês de dezembro de {year}, encerra-se o presente Livro de Atas do
              Atendimento Pedagógico e Acompanhamento Escolar do <strong>{school.name}</strong>,
              contendo o total de <strong>{totalAtas} ({numberToWords(totalAtas)})</strong> ata(s)
              oficialmente lavrada(s) e arquivada(s) eletronicamente sob responsabilidade da
              Equipe Pedagógica e Direção Escolar para fins de arquivo permanente na Secretaria
              Escolar e instrução processual junto ao Sistema e-Protocolo da SEED-PR.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 pt-12 font-sans text-xs text-center">
            <div className="border-t border-slate-800 pt-1">
              <p className="font-bold">Equipe Pedagógica</p>
              <p className="text-[10px] text-slate-500 uppercase">Servidores Públicos</p>
            </div>
            <div className="border-t border-slate-800 pt-1">
              <p className="font-bold">Direção Escolar</p>
              <p className="text-[10px] text-slate-500 uppercase">Colégio Estadual</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function numberToWords(num: number): string {
  if (num === 0) return "zero";
  if (num === 1) return "uma";
  if (num === 2) return "duas";
  return String(num);
}
