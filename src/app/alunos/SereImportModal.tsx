"use client";

import { useState, useMemo, useId } from "react";
import {
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  AlertTriangle,
  School,
  Sparkles,
  Loader2,
  RefreshCw,
  HelpCircle,
  Search,
  PhoneOff,
} from "lucide-react";
import ModalDialog from "@/components/ModalDialog";
import {
  consolidateSelectedStudents,
  decodeCsvBuffer,
  parseSereFiles,
  type SchoolSegment,
  type SchoolShift,
  type SereParseResult,
  type TurmaSelectionConfig,
} from "@/lib/sereParser";

interface ImportSummary {
  turmasCreated: number;
  turmasUpdated: number;
  createdCount: number;
  updatedCount: number;
  movedTurmaCount: number;
  reactivatedCount: number;
  cgmsBound: number;
  skippedExistingCount: number;
  deactivatedTransferredCount: number;
  missingPhoneImportedCount: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  existingClassGroups: Array<{ id: string; name: string; segment: string; shift?: string }>;
  isAdmin?: boolean;
  onImportComplete: (payload: {
    students: any[];
    classGroups: any[];
    filterMissingPhone?: boolean;
  }) => void;
}

export default function SereImportModal({
  open,
  onClose,
  existingClassGroups,
  isAdmin = false,
  onImportComplete,
}: Props) {
  const tableCaptionId = useId();

  const [loadedFileNames, setLoadedFileNames] = useState<string[]>([]);
  const [parseResult, setParseResult] = useState<SereParseResult | null>(null);
  const [turmaConfigs, setTurmaConfigs] = useState<Record<string, TurmaSelectionConfig>>({});

  // Opções de sincronização
  const [updateExisting, setUpdateExisting] = useState(true);
  const [deactivateTransferred, setDeactivateTransferred] = useState(true);
  const [includeSemFrequencia, setIncludeSemFrequencia] = useState(true);
  const [includeConcluinte, setIncludeConcluinte] = useState(true);
  const [updateSchoolInfo, setUpdateSchoolInfo] = useState(false);
  const [schoolNameEdit, setSchoolNameEdit] = useState("");
  const [schoolCityEdit, setSchoolCityEdit] = useState("");

  // Busca na prévia nominal
  const [studentPreviewQuery, setStudentPreviewQuery] = useState("");

  // Estado de submissão e resultado
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [lastResultPayload, setLastResultPayload] = useState<{
    students: any[];
    classGroups: any[];
  } | null>(null);

  const existingTurmaNamesUpper = useMemo(() => {
    return new Set(existingClassGroups.map((cg) => cg.name.trim().toUpperCase()));
  }, [existingClassGroups]);

  const existingTurmaByUpper = useMemo(() => {
    const map = new Map<string, { name: string; segment: string; shift?: string }>();
    for (const cg of existingClassGroups) {
      map.set(cg.name.trim().toUpperCase(), cg);
    }
    return map;
  }, [existingClassGroups]);

  const resetState = () => {
    setLoadedFileNames([]);
    setParseResult(null);
    setTurmaConfigs({});
    setErrorMsg("");
    setImportSummary(null);
    setLastResultPayload(null);
    setStudentPreviewQuery("");
    setUpdateSchoolInfo(false);
  };

  const handleClose = () => {
    if (isImporting) return;
    onClose();
  };

  const processFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter(
      (f) =>
        f.name.toLowerCase().endsWith(".csv") ||
        f.name.toLowerCase().endsWith(".txt") ||
        f.type.includes("csv") ||
        f.type.includes("text")
    );

    if (files.length === 0) {
      setErrorMsg("Selecione um ou mais arquivos .CSV exportados do SERE.");
      return;
    }

    setIsParsing(true);
    setErrorMsg("");
    setImportSummary(null);

    try {
      const decodedFiles = await Promise.all(
        files.map(async (f) => {
          const buffer = await f.arrayBuffer();
          return {
            fileName: f.name,
            content: decodeCsvBuffer(buffer),
          };
        })
      );

      const parsed = parseSereFiles(decodedFiles);
      if (parsed.turmas.length === 0) {
        setErrorMsg(
          parsed.warnings[0] ||
            "Nenhuma turma ou aluno encontrado nos arquivos enviados. Verifique se o relatório do SERE foi exportado no formato CSV."
        );
        setParseResult(null);
        setLoadedFileNames([]);
        return;
      }

      const nextConfigs: Record<string, TurmaSelectionConfig> = {};
      for (const t of parsed.turmas) {
        const matchedExisting = existingTurmaByUpper.get(t.suggestedName.toUpperCase());
        nextConfigs[t.tempId] = {
          tempId: t.tempId,
          selected: t.selectedByDefault,
          customName: matchedExisting ? matchedExisting.name : t.suggestedName,
          segment: (matchedExisting?.segment as SchoolSegment) || t.segment,
          shift: (matchedExisting?.shift as SchoolShift) || t.shift,
          isComplementary: t.isComplementary,
        };
      }

      setLoadedFileNames(files.map((f) => f.name));
      setParseResult(parsed);
      setTurmaConfigs(nextConfigs);

      if (parsed.schoolMetadata) {
        setSchoolNameEdit(
          parsed.schoolMetadata.formattedSchoolName || parsed.schoolMetadata.rawSchoolName
        );
        setSchoolCityEdit(parsed.schoolMetadata.city || "");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Falha ao ler o arquivo CSV.");
    } finally {
      setIsParsing(false);
    }
  };

  const consolidated = useMemo(() => {
    if (!parseResult) return null;
    return consolidateSelectedStudents(parseResult, turmaConfigs, {
      includeSemFrequencia,
      includeConcluinte,
    });
  }, [parseResult, turmaConfigs, includeSemFrequencia, includeConcluinte]);

  const filteredPreviewStudents = useMemo(() => {
    if (!consolidated) return [];
    const q = studentPreviewQuery.trim().toLowerCase();
    if (!q) return consolidated.studentsToImport.slice(0, 60);
    return consolidated.studentsToImport
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.cgm.includes(q) ||
          s.turmaName.toLowerCase().includes(q) ||
          s.phone.includes(q)
      )
      .slice(0, 60);
  }, [consolidated, studentPreviewQuery]);

  const updateTurmaField = <K extends keyof TurmaSelectionConfig>(
    tempId: string,
    field: K,
    value: TurmaSelectionConfig[K]
  ) => {
    setTurmaConfigs((prev) => ({
      ...prev,
      [tempId]: {
        ...prev[tempId],
        [field]: value,
      },
    }));
  };

  const handleConfirmImport = async () => {
    if (!consolidated || consolidated.studentsToImport.length === 0) {
      setErrorMsg("Selecione ao menos uma turma com alunos ativos para importar.");
      return;
    }

    setIsImporting(true);
    setErrorMsg("");

    try {
      const res = await fetch("/api/students/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          turmas: consolidated.turmasToImport,
          students: consolidated.studentsToImport.map((s) => ({
            cgm: s.cgm || null,
            name: s.name,
            phone: s.phone || "",
            guardianName: s.guardianName || null,
            turmaTempId: s.turmaTempId,
          })),
          transferredStudents: consolidated.transferredToDeactivate.map((t) => ({
            cgm: t.cgm || null,
            name: t.name,
          })),
          options: {
            updateExisting,
            deactivateTransferred,
            updateSchoolInfo: isAdmin && updateSchoolInfo,
            schoolInfo:
              isAdmin && updateSchoolInfo && schoolNameEdit.trim()
                ? {
                    name: schoolNameEdit.trim(),
                    city: schoolCityEdit.trim(),
                  }
                : null,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao gravar o lote de alunos.");
      }

      setImportSummary(data.summary);
      setLastResultPayload({
        students: data.students,
        classGroups: data.classGroups,
      });
      onImportComplete({
        students: data.students,
        classGroups: data.classGroups,
      });
    } catch (err: any) {
      setErrorMsg(err.message || "Falha de comunicação ao importar alunos.");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={handleClose}
      size="xl"
      title="Importação em Lote de Alunos (SERE / SEED-PR)"
      subtitle="Cadastre ou atualize turmas e estudantes de qualquer escola estadual diretamente pelos relatórios CSV por turno do SERE."
    >
      <div className="space-y-4 text-xs">
        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* TELA DE CONCLUSÃO */}
        {importSummary ? (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3 className="text-sm font-extrabold text-emerald-950">
                  Lote do SERE processado com sucesso!
                </h3>
                <p className="text-emerald-800">
                  As turmas, matrículas oficiais (CGM) e telefones já estão prontos para uso no Painel de Envio e na sincronização com Power BI e SERP.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                <span className="text-[10px] font-bold uppercase text-slate-500 block">
                  Novos Alunos
                </span>
                <strong className="text-xl font-black text-sky-700">
                  {importSummary.createdCount}
                </strong>
                <span className="text-[11px] text-slate-500 block">
                  +{importSummary.turmasCreated} nova(s) turma(s)
                </span>
              </div>

              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                <span className="text-[10px] font-bold uppercase text-slate-500 block">
                  Atualizados / Enturmados
                </span>
                <strong className="text-xl font-black text-emerald-700">
                  {importSummary.updatedCount}
                </strong>
                <span className="text-[11px] text-slate-500 block">
                  {importSummary.movedTurmaCount} remanejado(s) • {importSummary.cgmsBound} CGM(s) vinculado(s)
                </span>
              </div>

              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                <span className="text-[10px] font-bold uppercase text-slate-500 block">
                  Transferidos Inativados
                </span>
                <strong className="text-xl font-black text-slate-700">
                  {importSummary.deactivatedTransferredCount}
                </strong>
                <span className="text-[11px] text-slate-500 block">
                  {importSummary.skippedExistingCount} já idêntico(s)
                </span>
              </div>

              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                <span className="text-[10px] font-bold uppercase text-slate-500 block">
                  Sem Telefone no SERE
                </span>
                <strong
                  className={`text-xl font-black ${
                    importSummary.missingPhoneImportedCount > 0
                      ? "text-amber-600"
                      : "text-slate-700"
                  }`}
                >
                  {importSummary.missingPhoneImportedCount}
                </strong>
                <span className="text-[11px] text-slate-500 block">
                  Cadastrados p/ completar fone
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={resetState}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Importar Outro Turno / Arquivo</span>
              </button>

              <div className="flex items-center gap-2">
                {importSummary.missingPhoneImportedCount > 0 && lastResultPayload && (
                  <button
                    type="button"
                    onClick={() => {
                      onImportComplete({
                        ...lastResultPayload,
                        filterMissingPhone: true,
                      });
                      onClose();
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold"
                  >
                    <PhoneOff className="w-3.5 h-3.5" />
                    <span>Ver Alunos Sem Telefone</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold shadow-xs"
                >
                  Concluir
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* PASSO 1: INSTRUÇÃO + UPLOAD MÚLTIPLO */}
            <details className="group rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
              <summary className="cursor-pointer font-bold text-slate-700 flex items-center gap-2 list-none">
                <HelpCircle className="w-4 h-4 text-sky-600 shrink-0" />
                <span>Como extrair o arquivo de alunos no SERE (SEED-PR)?</span>
                <span className="ml-auto text-[11px] text-sky-700 font-semibold group-open:hidden">
                  Ver passo a passo
                </span>
              </summary>
              <ol className="mt-2.5 pl-5 list-decimal space-y-1 text-slate-600 leading-relaxed">
                <li>
                  Acesse o <strong>SERE (Sistema Estadual de Registro Escolar)</strong> → menu{" "}
                  <strong>Relatórios → Alunos → Relação de Alunos por Turma</strong>.
                </li>
                <li>
                  Gere o relatório por turno (<strong>Manhã</strong>, <strong>Tarde</strong> e{" "}
                  <strong>Noite</strong>) escolhendo o formato de saída <strong>CSV</strong>.
                </li>
                <li>
                  Selecione <strong>todos os arquivos de turno de uma só vez</strong> abaixo. O sistema cria as turmas, limpa telefones, filtra transferidos/remanejados e mescla matrículas duplas do Ensino Técnico automaticamente!
                </li>
              </ol>
            </details>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files?.length) {
                  processFiles(e.dataTransfer.files);
                }
              }}
              className={`p-4 rounded-2xl border-2 border-dashed transition ${
                isDragging
                  ? "border-sky-500 bg-sky-50"
                  : "border-slate-300 bg-slate-50/70 hover:border-sky-400"
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-sky-100 text-sky-700 shrink-0">
                    {isParsing ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Upload className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <label
                      htmlFor="sere-csv-upload"
                      className="font-bold text-slate-900 text-sm block cursor-pointer"
                    >
                      Selecione ou arraste os arquivos CSV do SERE (Manhã, Tarde, Noite)
                    </label>
                    <p className="text-slate-500 mt-0.5">
                      Aceita 1 ou múltiplos arquivos <code>.csv</code> simultaneamente (também aceita planilha CSV simples com Nome, Turma e Telefone).
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <input
                  id="sere-csv-upload"
                  type="file"
                  multiple
                  accept=".csv,.txt,text/csv"
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      processFiles(e.target.files);
                    }
                  }}
                  className="sere-file-input"
                />
              </div>

              {loadedFileNames.length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-bold text-slate-600">
                    Arquivos carregados:
                  </span>
                  {loadedFileNames.map((fn) => (
                    <span
                      key={fn}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-100 text-sky-900 font-semibold text-[11px]"
                    >
                      <FileSpreadsheet className="w-3 h-3" />
                      {fn}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* PASSO 2: REVISÃO DE TURMAS E ALUNOS */}
            {parseResult && consolidated && (
              <div className="space-y-4">
                {/* Banner da Escola Detectada no Cabeçalho SERE */}
                {parseResult.schoolMetadata && (
                  <div className="p-3 rounded-xl bg-slate-900 text-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <School className="w-5 h-5 text-sky-400 shrink-0" />
                      <div>
                        <div className="font-bold text-sm text-white">
                          {parseResult.schoolMetadata.formattedSchoolName ||
                            parseResult.schoolMetadata.rawSchoolName}
                        </div>
                        <div className="text-[11px] text-slate-300">
                          SERE:{" "}
                          <span className="font-mono">
                            {parseResult.schoolMetadata.rawSchoolName}
                          </span>
                          {parseResult.schoolMetadata.city &&
                            ` • Município: ${parseResult.schoolMetadata.city}`}
                          {parseResult.schoolMetadata.reportDate &&
                            ` • Emissão: ${parseResult.schoolMetadata.reportDate}`}
                        </div>
                      </div>
                    </div>

                    {isAdmin && (
                      <label className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer text-[11px] font-semibold text-sky-200 shrink-0">
                        <input
                          type="checkbox"
                          checked={updateSchoolInfo}
                          onChange={(e) => setUpdateSchoolInfo(e.target.checked)}
                          className="checkbox-custom"
                        />
                        <span>Usar como identificação desta Escola</span>
                      </label>
                    )}
                  </div>
                )}

                {isAdmin && updateSchoolInfo && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-sky-50 border border-sky-200">
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">
                        Nome Institucional da Escola (Cabeçalhos & Dossiês PDF):
                      </label>
                      <input
                        type="text"
                        value={schoolNameEdit}
                        onChange={(e) => setSchoolNameEdit(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded-lg bg-white font-semibold"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">
                        Município:
                      </label>
                      <input
                        type="text"
                        value={schoolCityEdit}
                        onChange={(e) => setSchoolCityEdit(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                      />
                    </div>
                  </div>
                )}

                {/* Indicadores Rápidos */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-2.5 rounded-xl border border-slate-200 bg-white">
                    <span className="text-[10px] font-bold uppercase text-slate-500 block">
                      Turmas Selecionadas
                    </span>
                    <strong className="text-lg font-black text-slate-900">
                      {consolidated.stats.selectedTurmasCount}
                    </strong>
                    <span className="text-[10px] text-slate-500 block">
                      de {parseResult.turmas.length} bloco(s) lido(s)
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl border border-sky-200 bg-sky-50/60">
                    <span className="text-[10px] font-bold uppercase text-sky-800 block">
                      Alunos a Importar
                    </span>
                    <strong className="text-lg font-black text-sky-700">
                      {consolidated.stats.activeStudentsCount}
                    </strong>
                    <span className="text-[10px] text-sky-700 block">
                      Deduplicados por CGM
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl border border-slate-200 bg-white">
                    <span className="text-[10px] font-bold uppercase text-slate-500 block">
                      Filtrados (SERE)
                    </span>
                    <strong className="text-lg font-black text-slate-700">
                      {consolidated.stats.skippedInternalMoveCount +
                        consolidated.stats.skippedLeftSchoolCount +
                        consolidated.stats.mergedDualMatrixTotal}
                    </strong>
                    <span className="text-[10px] text-slate-500 block">
                      Transf./Remanej./Dupla Matriz
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl border border-slate-200 bg-white">
                    <span className="text-[10px] font-bold uppercase text-slate-500 block">
                      Sem Telefone
                    </span>
                    <strong
                      className={`text-lg font-black ${
                        consolidated.stats.missingPhoneCount > 0
                          ? "text-amber-600"
                          : "text-emerald-700"
                      }`}
                    >
                      {consolidated.stats.missingPhoneCount}
                    </strong>
                    <span className="text-[10px] text-slate-500 block">
                      {consolidated.stats.missingPhoneCount > 0
                        ? "Serão sinalizados na lista"
                        : "100% com fone preenchido"}
                    </span>
                  </div>
                </div>

                {/* Tabela Editável de Turmas (modern-web-guidance: responsive-table) */}
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-bold text-slate-800 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-sky-600" />
                      <span>
                        Mapeamento de Turmas (edite o nome caso sua escola use outra sigla, ex: 6º A)
                      </span>
                    </h3>
                    <div className="flex items-center gap-2 text-[11px]">
                      <button
                        type="button"
                        onClick={() => {
                          setTurmaConfigs((prev) => {
                            const next = { ...prev };
                            for (const k of Object.keys(next)) {
                              next[k] = {
                                ...next[k],
                                selected: !next[k].isComplementary,
                              };
                            }
                            return next;
                          });
                        }}
                        className="text-sky-700 hover:underline font-semibold"
                      >
                        Apenas Regulares
                      </button>
                      <span className="text-slate-300">•</span>
                      <button
                        type="button"
                        onClick={() => {
                          setTurmaConfigs((prev) => {
                            const next = { ...prev };
                            for (const k of Object.keys(next)) {
                              next[k] = { ...next[k], selected: false };
                            }
                            return next;
                          });
                        }}
                        className="text-slate-500 hover:underline font-medium"
                      >
                        Desmarcar Todas
                      </button>
                    </div>
                  </div>

                  <div
                    tabIndex={0}
                    role="region"
                    aria-labelledby={tableCaptionId}
                    className="sere-turma-table-wrapper rounded-xl border border-slate-200 bg-white"
                  >
                    <table className="w-full text-left text-xs">
                      <caption id={tableCaptionId} className="sr-only">
                        Turmas identificadas nos arquivos CSV do SERE para configuração e importação
                      </caption>
                      <thead className="bg-slate-100 text-slate-600 uppercase font-bold text-[10px] border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2.5">Turma no Sistema</th>
                          <th className="px-3 py-2.5">Curso / Série no SERE</th>
                          <th className="px-3 py-2.5">Nível</th>
                          <th className="px-3 py-2.5">Turno</th>
                          <th className="px-3 py-2.5 text-center">Ativos</th>
                          <th className="px-3 py-2.5 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {parseResult.turmas.map((t) => {
                          const cfg = turmaConfigs[t.tempId];
                          if (!cfg) return null;

                          const activeInTurma = t.students.filter(
                            (s) =>
                              s.statusCategory === "ACTIVE" ||
                              (includeSemFrequencia && s.statusCategory === "SEM_FREQUENCIA") ||
                              (includeConcluinte && s.statusCategory === "CONCLUINTE")
                          ).length;

                          const existsInDb = existingTurmaNamesUpper.has(
                            cfg.customName.trim().toUpperCase()
                          );

                          return (
                            <tr
                              key={t.tempId}
                              className={cfg.selected ? "bg-white" : "bg-slate-50/80 opacity-65"}
                            >
                              <th scope="row" className="px-3 py-2 font-semibold text-slate-900">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={cfg.selected}
                                    onChange={(e) =>
                                      updateTurmaField(t.tempId, "selected", e.target.checked)
                                    }
                                    aria-label={`Importar turma ${cfg.customName}`}
                                    className="checkbox-custom shrink-0"
                                  />
                                  <input
                                    type="text"
                                    value={cfg.customName}
                                    onChange={(e) =>
                                      updateTurmaField(t.tempId, "customName", e.target.value)
                                    }
                                    aria-label={`Nome da turma para ${t.seriacaoRaw} ${t.turmaRaw}`}
                                    className="w-28 sm:w-32 px-2 py-1 border border-slate-300 rounded-lg bg-white font-bold text-slate-900 text-xs"
                                  />
                                </div>
                              </th>

                              <td className="px-3 py-2 text-slate-600">
                                <div className="font-semibold text-slate-800">
                                  {t.seriacaoRaw}{" "}
                                  {t.turmaRaw ? `• Turma ${t.turmaRaw}` : ""}
                                </div>
                                <div className="text-[10px] text-slate-500 truncate max-w-[240px]">
                                  {t.cursoRaw}
                                </div>
                                {t.mergedDualMatrixCount > 0 && (
                                  <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold text-[10px]">
                                    Dupla matrícula técnica mesclada
                                  </span>
                                )}
                                {t.isComplementary && (
                                  <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px]">
                                    Programa Complementar
                                  </span>
                                )}
                              </td>

                              <td className="px-3 py-2">
                                <select
                                  value={cfg.segment}
                                  onChange={(e) =>
                                    updateTurmaField(
                                      t.tempId,
                                      "segment",
                                      e.target.value as SchoolSegment
                                    )
                                  }
                                  aria-label={`Nível da turma ${cfg.customName}`}
                                  className="p-1.5 border border-slate-300 rounded-lg bg-white text-[11px] font-medium"
                                >
                                  <option value="FUNDAMENTAL">Fundamental</option>
                                  <option value="MEDIO">Médio</option>
                                  <option value="NOTURNO">Noturno</option>
                                </select>
                              </td>

                              <td className="px-3 py-2">
                                <select
                                  value={cfg.shift}
                                  onChange={(e) =>
                                    updateTurmaField(
                                      t.tempId,
                                      "shift",
                                      e.target.value as SchoolShift
                                    )
                                  }
                                  aria-label={`Turno da turma ${cfg.customName}`}
                                  className="p-1.5 border border-slate-300 rounded-lg bg-white text-[11px] font-medium"
                                >
                                  <option value="MANHA">Manhã</option>
                                  <option value="TARDE">Tarde</option>
                                  <option value="NOITE">Noite</option>
                                </select>
                              </td>

                              <td className="px-3 py-2 text-center font-bold text-slate-800">
                                {activeInTurma}
                              </td>

                              <td className="px-3 py-2 text-right whitespace-nowrap">
                                {existsInDb ? (
                                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                                    Turma Existente
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 font-bold text-[10px]">
                                    Criar Turma
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Regras de Sincronização (browser-ui-theming: label:has(:checked)) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <label className="sere-option-card flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={updateExisting}
                      onChange={(e) => setUpdateExisting(e.target.checked)}
                      className="checkbox-custom mt-0.5 shrink-0"
                    />
                    <div>
                      <span className="font-bold text-slate-800 block">
                        Atualizar alunos já cadastrados (CGM, Turma e Telefone)
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Preserva histórico de mensagens, atestados e nomes de responsáveis já salvos.
                      </span>
                    </div>
                  </label>

                  <label className="sere-option-card flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={deactivateTransferred}
                      onChange={(e) => setDeactivateTransferred(e.target.checked)}
                      className="checkbox-custom mt-0.5 shrink-0"
                    />
                    <div>
                      <span className="font-bold text-slate-800 block">
                        Inativar Transferidos / Desistentes ({consolidated.transferredToDeactivate.length})
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Inativa quem saiu da escola sem apagar o prontuário histórico.
                      </span>
                    </div>
                  </label>

                  <label className="sere-option-card flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeSemFrequencia}
                      onChange={(e) => setIncludeSemFrequencia(e.target.checked)}
                      className="checkbox-custom mt-0.5 shrink-0"
                    />
                    <div>
                      <span className="font-bold text-slate-800 block">
                        Incluir situação &ldquo;Sem Frequência&rdquo;
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Recomendado: mantém alunos infrequentes visíveis para Busca Ativa.
                      </span>
                    </div>
                  </label>

                  <label className="sere-option-card flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeConcluinte}
                      onChange={(e) => setIncludeConcluinte(e.target.checked)}
                      className="checkbox-custom mt-0.5 shrink-0"
                    />
                    <div>
                      <span className="font-bold text-slate-800 block">
                        Incluir situação &ldquo;Concluinte&rdquo;
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Recomendado para cursos técnicos (alunos em aproveitamento de estudos).
                      </span>
                    </div>
                  </label>
                </div>

                {/* Conferência Nominal Expansível */}
                <details className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                  <summary className="cursor-pointer font-bold text-slate-700">
                    Conferir lista nominal de alunos ({consolidated.studentsToImport.length} selecionados)
                  </summary>
                  <div className="mt-3 space-y-2.5">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        placeholder="Filtrar prévia por nome, CGM, turma ou telefone..."
                        value={studentPreviewQuery}
                        onChange={(e) => setStudentPreviewQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                      />
                    </div>
                    <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
                      {filteredPreviewStudents.map((st, idx) => (
                        <div
                          key={`${st.cgm || st.name}-${idx}`}
                          className="px-3 py-1.5 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <span className="font-bold text-slate-800 truncate block">
                              {st.name}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              CGM: {st.cgm || "—"} • Turma: {st.turmaName} • SERE: {st.situacaoRaw}
                            </span>
                          </div>
                          <div className="shrink-0 font-mono text-[11px]">
                            {st.phone ? (
                              <span className="text-slate-700">{st.phone}</span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-sans font-bold text-[10px]">
                                Sem telefone
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              </div>
            )}

            {/* Barra de Ação Inferior */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                disabled={isImporting}
                onClick={handleClose}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50 font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={
                  isImporting ||
                  !consolidated ||
                  consolidated.stats.activeStudentsCount === 0
                }
                onClick={handleConfirmImport}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-45 text-white font-bold shadow-sm transition"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Importando Lote...</span>
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>
                      {consolidated
                        ? `Confirmar Importação (${consolidated.stats.activeStudentsCount} Alunos)`
                        : "Confirmar Importação"}
                    </span>
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalDialog>
  );
}
