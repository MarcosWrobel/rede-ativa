"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  Calendar,
  ClipboardList,
  FileUp,
  Search,
  Users,
} from "lucide-react";
import {
  formatSegmentLabel,
  formatShiftLabel,
  type CouncilIndexBoardItem,
  type CouncilIndexClassGroupItem,
} from "@/components/conselho/types";

interface ConselhoIndexClientProps {
  initialYear: number;
  initialClassGroups: CouncilIndexClassGroupItem[];
  initialBoards: CouncilIndexBoardItem[];
  schoolName: string;
  canEdit: boolean;
  canUseBiScraper?: boolean;
}

export default function ConselhoIndexClient({
  initialYear,
  initialClassGroups,
  initialBoards,
  schoolName,
  canEdit,
  canUseBiScraper = false,
}: ConselhoIndexClientProps) {
  const router = useRouter();
  const [year, setYear] = useState<number>(initialYear);
  const [classGroups, setClassGroups] =
    useState<CouncilIndexClassGroupItem[]>(initialClassGroups);
  const [boards, setBoards] = useState<CouncilIndexBoardItem[]>(initialBoards);
  const [searchTerm, setSearchTerm] = useState("");
  const [shiftFilter, setShiftFilter] = useState("ALL");
  const [loadingYear, setLoadingYear] = useState(false);
  const [openingClassId, setOpeningClassId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const boardByClassId = useMemo(() => {
    return new Map(boards.map((b) => [b.classGroupId, b]));
  }, [boards]);

  const filteredClassGroups = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return classGroups.filter((cg) => {
      if (shiftFilter !== "ALL" && cg.shift.toUpperCase() !== shiftFilter) {
        return false;
      }
      if (q && !cg.name.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [classGroups, searchTerm, shiftFilter]);

  async function handleYearChange(nextYear: number) {
    setYear(nextYear);
    setLoadingYear(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/conselho-classe?year=${nextYear}`);
      const data: {
        success?: boolean;
        classGroups?: CouncilIndexClassGroupItem[];
        boards?: CouncilIndexBoardItem[];
        error?: string;
      } = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Não foi possível carregar as turmas do ano letivo.");
        return;
      }
      setClassGroups(data.classGroups || []);
      setBoards(data.boards || []);
    } catch {
      setErrorMsg("Falha de conexão ao consultar o ano letivo.");
    } finally {
      setLoadingYear(false);
    }
  }

  async function handleOpenBoard(classGroupId: string) {
    const existing = boardByClassId.get(classGroupId);
    if (existing) {
      router.push(`/conselho-classe/${existing.id}`);
      return;
    }
    if (!canEdit) {
      setErrorMsg("Conselho de classe ainda não iniciado para esta turma.");
      return;
    }

    setOpeningClassId(classGroupId);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/conselho-classe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classGroupId, year }),
      });
      const data: {
        success?: boolean;
        board?: { id: string };
        error?: string;
      } = await res.json();

      if (!res.ok || !data.board) {
        setErrorMsg(data.error || "Não foi possível abrir o conselho desta turma.");
        return;
      }

      router.push(`/conselho-classe/${data.board.id}`);
    } catch {
      setErrorMsg("Falha de conexão ao inicializar o conselho da turma.");
    } finally {
      setOpeningClassId(null);
    }
  }

  const yearOptions = Array.from(
    new Set([initialYear - 1, initialYear, initialYear + 1])
  ).sort((a, b) => b - a);

  return (
    <div className="space-y-6">
      <header className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 flex items-center justify-center shrink-0">
            <ClipboardList className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
              Conselho de Classe e Pós-Conselho
            </h1>
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              {schoolName} • Acompanhamento trimestral por turma e estudante
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2">
            <Calendar className="w-3.5 h-3.5 text-sky-600" />
            <label htmlFor="council-year-select" className="sr-only">
              Ano letivo
            </label>
            <select
              id="council-year-select"
              disabled={loadingYear}
              value={year}
              onChange={(e) => handleYearChange(Number(e.target.value))}
              className="bg-transparent text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  Ano letivo {y}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 px-4 py-3 text-xs font-bold text-rose-800 dark:text-rose-200"
        >
          {errorMsg}
        </div>
      )}

      {canEdit && (
        <div className="rounded-2xl border border-sky-200 dark:border-sky-800 bg-sky-50/70 dark:bg-sky-950/40 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <FileUp className="w-4 h-4 text-sky-700 dark:text-sky-300 mt-0.5 shrink-0" />
            <div className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
              <strong className="font-bold text-slate-900 dark:text-white">
                Importação de notas via PDF do SERE:
              </strong>{" "}
              abra uma turma abaixo e clique em <span className="font-semibold">Importar PDF SERE</span>{" "}
              para enviar o Relatório de Acompanhamento Trimestral (incluindo os dois arquivos de
              matriz da 3ª série) e preencher notas, componentes curriculares e lista abaixo de 6,0.
            </div>
          </div>
          {canUseBiScraper && (
            <div className="flex items-center gap-2 shrink-0 text-xs font-bold">
              <Link
                href="/gestao"
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                Gestão Escolar
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Barra de Filtros */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Buscar turma"
            placeholder="Buscar turma..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
          />
        </div>
        <select
          aria-label="Filtrar por turno"
          value={shiftFilter}
          onChange={(e) => setShiftFilter(e.target.value)}
          className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-bold text-slate-800 dark:text-slate-100"
        >
          <option value="ALL">Todos os turnos</option>
          <option value="MANHA">Manhã</option>
          <option value="TARDE">Tarde</option>
          <option value="NOITE">Noite</option>
          <option value="INTEGRAL">Integral</option>
        </select>
      </div>

      {/* Grade de Turmas */}
      {filteredClassGroups.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center text-xs text-slate-500">
          Nenhuma turma encontrada para o filtro selecionado.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredClassGroups.map((cg) => {
            const board = boardByClassId.get(cg.id);
            const isOpening = openingClassId === cg.id;

            return (
              <article
                key={cg.id}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs flex flex-col justify-between gap-4 hover:border-sky-300 dark:hover:border-sky-700 transition"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-base font-black text-slate-900 dark:text-white">
                        {cg.name}
                      </h2>
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {formatSegmentLabel(cg.segment)} • {formatShiftLabel(cg.shift)}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        board
                          ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800"
                          : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
                      }`}
                    >
                      {board ? "Iniciado" : "Não iniciado"}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <Users className="w-3.5 h-3.5 text-sky-600" />
                      {cg._count.students} estudantes ativos
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                      {board ? `${board._count.subjects} componentes` : "0 componentes"}
                    </span>
                  </div>

                  {/* Status dos 3 Trimestres */}
                  <div className="grid grid-cols-3 gap-1.5 pt-1">
                    {([1, 2, 3] as const).map((tri) => {
                      const triRec = board?.trimesters.find((t) => t.trimester === tri);
                      const consolidated = triRec?.status === "CONSOLIDATED";
                      return (
                        <div
                          key={tri}
                          className={`rounded-xl border px-2 py-1.5 text-center ${
                            consolidated
                              ? "bg-emerald-50/70 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200"
                              : board
                                ? "bg-sky-50/50 border-sky-200 text-sky-900 dark:bg-sky-950/30 dark:border-sky-800 dark:text-sky-200"
                                : "bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-950 dark:border-slate-800"
                          }`}
                        >
                          <div className="text-[10px] font-extrabold">{tri}º Trim.</div>
                          <div className="text-[10px]">
                            {consolidated ? "Consolidado" : board ? "Em aberto" : "Pendente"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isOpening}
                  onClick={() => handleOpenBoard(cg.id)}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-sky-600 dark:hover:bg-sky-500 disabled:opacity-60 text-white text-xs font-bold transition cursor-pointer"
                >
                  <span>
                    {isOpening
                      ? "Abrindo..."
                      : board
                        ? "Abrir conselho"
                        : canEdit
                          ? "Iniciar conselho"
                          : "Visualizar"}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
