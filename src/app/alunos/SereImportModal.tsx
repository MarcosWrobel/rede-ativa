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
  Download,
} from "lucide-react";
import ModalDialog from "@/components/ModalDialog";
import {
  MAX_SERE_BATCH_TOTAL_BYTES,
  MAX_SERE_FILE_SIZE_BYTES,
  consolidateSelectedStudents,
  parseSereRawFiles,
  resolveSereTurmaMatch,
  type SchoolSegment,
  type SchoolShift,
  type SereParseResult,
  type TurmaSelectionConfig,
} from "@/lib/sereParser";
import { normalizeClassGroupKey } from "@/lib/classGroupName";

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

export function buildInitialTurmaPreviewState(params: {
  parsed: SereParseResult;
  existingClassGroups: Array<{ id: string; name: string; segment: string; shift?: string }>;
  existingStudentsByCgm: Map<string, { classGroupId: string }>;
}): {
  configs: Record<string, TurmaSelectionConfig>;
  ambiguousLineIds: Set<string>;
} {
  const { parsed, existingClassGroups, existingStudentsByCgm } = params;
  const normalizedGroups = existingClassGroups.map((cg) => ({
    id: cg.id,
    name: cg.name,
    segment: cg.segment,
    shift: cg.shift || "MANHA",
  }));

  const configs: Record<string, TurmaSelectionConfig> = {};
  const ambiguousLineIds = new Set<string>();

  for (const t of parsed.turmas) {
    const resolution = resolveSereTurmaMatch({
      name: t.suggestedName,
      shift: t.shift,
      sourceIdentity: t.sourceIdentity,
      studentCgms: t.students.map((s) => s.cgm).filter(Boolean),
      existingClassGroups: normalizedGroups,
      existingStudentsByCgm,
    });
    const matchedExisting =
      resolution.status === "matched" && resolution.matchedClassGroupId
        ? existingClassGroups.find((cg) => cg.id === resolution.matchedClassGroupId)
        : undefined;

    if (resolution.status === "ambiguous") {
      ambiguousLineIds.add(t.tempId);
    }

    configs[t.tempId] = {
      tempId: t.tempId,
      selected: t.selectedByDefault,
      customName: matchedExisting ? matchedExisting.name : t.suggestedName,
      ...(matchedExisting ? { targetClassGroupId: matchedExisting.id } : {}),
      draftName: t.suggestedName,
      draftSegment: t.segment,
      draftShift: t.shift,
      segment: (matchedExisting?.segment as SchoolSegment) || t.segment,
      shift: (matchedExisting?.shift as SchoolShift) || t.shift,
      isComplementary: t.isComplementary,
    };
  }

  return { configs, ambiguousLineIds };
}

export function applyTurmaTargetSelection(params: {
  prevConfigs: Record<string, TurmaSelectionConfig>;
  tempId: string;
  rawValue: string;
  existingClassGroups: Array<{ id: string; name: string; segment: string; shift?: string }>;
}): Record<string, TurmaSelectionConfig> {
  const { prevConfigs, tempId, rawValue, existingClassGroups } = params;
  const current = prevConfigs[tempId];
  if (!current) return prevConfigs;

  const isCreateNew = rawValue === "__CREATE_NEW__";
  const nextId = rawValue && !isCreateNew ? rawValue : undefined;
  const chosen = nextId
    ? existingClassGroups.find((cg) => cg.id === nextId)
    : undefined;

  const draftName = current.draftName ?? current.customName;
  const draftSegment = current.draftSegment ?? current.segment;
  const draftShift = current.draftShift ?? current.shift;

  return {
    ...prevConfigs,
    [tempId]: {
      ...current,
      draftName,
      draftSegment,
      draftShift,
      targetClassGroupId: nextId,
      confirmCreateNew: isCreateNew || undefined,
      ...(chosen
        ? {
            customName: chosen.name,
            segment: chosen.segment as SchoolSegment,
            shift: (chosen.shift || current.shift) as SchoolShift,
          }
        : {
            customName: draftName,
            segment: draftSegment,
            shift: draftShift,
          }),
    },
  };
}

export function reopenAmbiguousTurmasFrom409(params: {
  prevConfigs: Record<string, TurmaSelectionConfig>;
  prevAmbiguousIds: Set<string>;
  ambiguousTurmas: Array<{ tempId: string }>;
}): {
  configs: Record<string, TurmaSelectionConfig>;
  ambiguousLineIds: Set<string>;
} {
  const affectedIds = new Set(params.ambiguousTurmas.map((item) => item.tempId));
  const ambiguousLineIds = new Set([...params.prevAmbiguousIds, ...affectedIds]);
  const configs = { ...params.prevConfigs };
  for (const tid of affectedIds) {
    if (configs[tid]) {
      const curr = configs[tid];
      configs[tid] = {
        ...curr,
        targetClassGroupId: undefined,
        confirmCreateNew: undefined,
        customName: curr.draftName ?? curr.customName,
        segment: curr.draftSegment ?? curr.segment,
        shift: curr.draftShift ?? curr.shift,
      };
    }
  }
  return { configs, ambiguousLineIds };
}

export function isTurmaAmbiguousUnresolved(
  tempId: string,
  cfg: TurmaSelectionConfig | undefined,
  ambiguousLineIds: Set<string>
): boolean {
  return Boolean(
    cfg?.selected &&
      ambiguousLineIds.has(tempId) &&
      !cfg.targetClassGroupId &&
      !cfg.confirmCreateNew
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  existingClassGroups: Array<{ id: string; name: string; segment: string; shift?: string }>;
  existingStudents?: Array<{ cgm?: string | null; classGroupId: string }>;
  isAdmin?: boolean;
  isIntegrated?: boolean;
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
  existingStudents = [],
  isAdmin = false,
  isIntegrated = false,
  onImportComplete,
}: Props) {
  const tableCaptionId = useId();

  const [loadedFileNames, setLoadedFileNames] = useState<string[]>([]);
  const [parseResult, setParseResult] = useState<SereParseResult | null>(null);
  const [turmaConfigs, setTurmaConfigs] = useState<Record<string, TurmaSelectionConfig>>({});
  const [ambiguousLineIds, setAmbiguousLineIds] = useState<Set<string>>(new Set());

  const existingStudentsByCgm = useMemo(() => {
    const map = new Map<string, { classGroupId: string }>();
    for (const st of existingStudents) {
      const clean = (st.cgm || "").replace(/\D/g, "").trim();
      if (clean && st.classGroupId) {
        map.set(clean, { classGroupId: st.classGroupId });
      }
    }
    return map;
  }, [existingStudents]);

  const existingClassGroupsNormalized = useMemo(
    () =>
      existingClassGroups.map((cg) => ({
        id: cg.id,
        name: cg.name,
        segment: cg.segment,
        shift: cg.shift || "MANHA",
      })),
    [existingClassGroups]
  );

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
    return new Set(existingClassGroups.map((cg) => normalizeClassGroupKey(cg.name)));
  }, [existingClassGroups]);

  const existingTurmaByUpper = useMemo(() => {
    const map = new Map<string, { id: string; name: string; segment: string; shift?: string }>();
    for (const cg of existingClassGroups) {
      map.set(normalizeClassGroupKey(cg.name), cg);
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

  const handleDownloadSampleCsv = () => {
    const sampleRows = [
      "CGM;NOME DO ALUNO;TURMA;TURNO;TELEFONE;RESPONSAVEL;SITUACAO",
      "1018613001;ALICE MENEZES DA SILVA;6º Ano A;Manhã;41991234567;MARIA MENEZES;Matriculado",
      "1018613002;BRUNO CARVALHO DE OLIVEIRA;6º Ano A;Manhã;41992345678;JOAO CARVALHO;Matriculado",
      "1018613003;CLARA LUZ PEREIRA;1º Ano Médio B;Tarde;41993456789;FERNANDA LUZ;Matriculado",
      "1018613004;DANIEL SOUZA DOS SANTOS;1º Ano Médio B;Tarde;41994567890;ROBERTO SOUZA;Matriculado",
      "1018613005;EDUARDA LIMA ROCHA;EJA Fase I;Noite;41995678901;CARLA LIMA;Matriculado",
    ].join("\r\n");

    const blob = new Blob(["\uFEFF" + sampleRows], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "modelo_importacao_sere_exemplo.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const processFiles = async (fileList: FileList | File[]) => {
    const validExtensions = [".xls", ".xlsx", ".pdf", ".csv", ".txt"];
    const files = Array.from(fileList).filter((f) => {
      const lower = f.name.toLowerCase();
      return (
        validExtensions.some((ext) => lower.endsWith(ext)) ||
        f.type.includes("sheet") ||
        f.type.includes("excel") ||
        f.type.includes("pdf") ||
        f.type.includes("csv") ||
        f.type.includes("text")
      );
    });

    if (files.length === 0) {
      setErrorMsg("Selecione um ou mais arquivos em formato Excel (.xls, .xlsx), PDF ou CSV exportados do SERE.");
      return;
    }

    const oversizedFile = files.find((f) => f.size > MAX_SERE_FILE_SIZE_BYTES);
    if (oversizedFile) {
      setErrorMsg(
        `O arquivo "${oversizedFile.name}" excede o limite máximo permitido de 10 MB por arquivo.`
      );
      return;
    }

    const totalBatchBytes = files.reduce((sum, f) => sum + f.size, 0);
    if (totalBatchBytes > MAX_SERE_BATCH_TOTAL_BYTES) {
      setErrorMsg(
        "O tamanho total dos arquivos selecionados excede o limite máximo permitido de 25 MB por lote."
      );
      return;
    }

    setIsParsing(true);
    setErrorMsg("");
    setImportSummary(null);

    try {
      const rawInputs = await Promise.all(
        files.map(async (f) => {
          const buffer = await f.arrayBuffer();
          return {
            fileName: f.name,
            buffer,
          };
        })
      );

      const parsed = await parseSereRawFiles(rawInputs);
      if (parsed.turmas.length === 0) {
        setErrorMsg(
          parsed.warnings[0] ||
            "Nenhuma turma ou aluno encontrado nos arquivos enviados. Verifique se o relatório do SERE corresponde à 'Relação de Alunos por Turma' em XLS, PDF ou CSV."
        );
        setParseResult(null);
        setLoadedFileNames([]);
        return;
      }

      const { configs: nextConfigs, ambiguousLineIds: nextAmbiguous } =
        buildInitialTurmaPreviewState({
          parsed,
          existingClassGroups,
          existingStudentsByCgm,
        });

      setLoadedFileNames(files.map((f) => f.name));
      setParseResult(parsed);
      setTurmaConfigs(nextConfigs);
      setAmbiguousLineIds(nextAmbiguous);

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
    setTurmaConfigs((prev) => {
      const curr = prev[tempId];
      if (!curr) return prev;
      const isEditingDraft = !curr.targetClassGroupId;
      return {
        ...prev,
        [tempId]: {
          ...curr,
          [field]: value,
          ...(isEditingDraft && field === "customName" ? { draftName: value as string } : {}),
          ...(isEditingDraft && field === "segment" ? { draftSegment: value as SchoolSegment } : {}),
          ...(isEditingDraft && field === "shift" ? { draftShift: value as SchoolShift } : {}),
        },
      };
    });
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
        if (
          res.status === 409 &&
          data.code === "AMBIGUOUS_CLASS_GROUP" &&
          Array.isArray(data.ambiguousTurmas)
        ) {
          const reopened = reopenAmbiguousTurmasFrom409({
            prevConfigs: turmaConfigs,
            prevAmbiguousIds: ambiguousLineIds,
            ambiguousTurmas: data.ambiguousTurmas,
          });
          setAmbiguousLineIds(reopened.ambiguousLineIds);
          setTurmaConfigs(reopened.configs);
        }
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
      title="Importação em Lote de Alunos (SERE)"
      subtitle="Cadastre ou atualize turmas e estudantes diretamente pelos relatórios em Excel (.xls/.xlsx), PDF ou CSV compatíveis com o SERE."
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
                  {isIntegrated
                    ? "As turmas, matrículas (CGM) e telefones já estão prontos para uso na Busca Ativa e na sincronização com Power BI e SERP."
                    : "As turmas, matrículas (CGM) e telefones já estão prontos para uso na Busca Ativa e no acompanhamento de frequência."}
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
                  <strong>Noite</strong>) escolhendo o formato de saída <strong>XLS (Excel)</strong> ou <strong>PDF</strong>.
                </li>
                <li>
                  Selecione <strong>todos os arquivos de turno (.xls, .pdf ou .csv) de uma só vez</strong> abaixo. O sistema cria as turmas, extrai CGMs e telefones, filtra transferidos/remanejados e mescla matrículas duplas do Ensino Técnico automaticamente!
                </li>
              </ol>
            </details>

            {/* Atalho para download de modelo de testes */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-sky-50/70 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/40">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                <span className="text-xs text-slate-700 dark:text-slate-300">
                  Deseja testar uma escola ou cadastrar via planilha padronizada?
                </span>
              </div>
              <button
                type="button"
                onClick={handleDownloadSampleCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-slate-700 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 font-bold text-xs shadow-2xs transition cursor-pointer self-start sm:self-auto"
              >
                <Download className="w-3.5 h-3.5 text-sky-600" />
                <span>Baixar Planilha Modelo (Exemplo CSV)</span>
              </button>
            </div>

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
                      Selecione ou arraste os arquivos do SERE (XLS, PDF ou CSV)
                    </label>
                    <p className="text-slate-500 mt-0.5">
                      Suporte nativo a <strong>.xls (Excel)</strong>, <strong>.pdf</strong> e <strong>.csv</strong>. Pode enviar múltiplos turnos simultaneamente (Manhã, Tarde, Noite).
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <input
                  id="sere-csv-upload"
                  type="file"
                  multiple
                  accept=".xls,.xlsx,.pdf,.csv,.txt,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf,text/csv"
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
                        Nome Institucional da Escola (Cabeçalhos & Relatórios PDF):
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

                          const existsInDb =
                            Boolean(cfg.targetClassGroupId) ||
                            (!ambiguousLineIds.has(t.tempId) &&
                              existingTurmaNamesUpper.has(
                                normalizeClassGroupKey(cfg.customName)
                              ));
                          const isAmbiguous = isTurmaAmbiguousUnresolved(
                            t.tempId,
                            cfg,
                            ambiguousLineIds
                          );

                          return (
                            <tr
                              key={t.tempId}
                              className={
                                isAmbiguous
                                  ? "bg-amber-50/70"
                                  : cfg.selected
                                    ? "bg-white"
                                    : "bg-slate-50/80 opacity-65"
                              }
                            >
                              <th scope="row" className="px-3 py-2 font-semibold text-slate-900">
                                <div className="space-y-1">
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
                                  <select
                                    value={
                                      cfg.targetClassGroupId
                                        ? cfg.targetClassGroupId
                                        : cfg.confirmCreateNew
                                          ? "__CREATE_NEW__"
                                          : ""
                                    }
                                    onChange={(e) => {
                                      const rawVal = e.target.value;
                                      setTurmaConfigs((prev) =>
                                        applyTurmaTargetSelection({
                                          prevConfigs: prev,
                                          tempId: t.tempId,
                                          rawValue: rawVal,
                                          existingClassGroups,
                                        })
                                      );
                                    }}
                                    aria-label={`Vincular turma existente para ${t.seriacaoRaw} ${t.turmaRaw}`}
                                    className={`w-full px-2 py-1 border rounded-lg text-[11px] font-medium ${
                                      isAmbiguous
                                        ? "border-amber-400 bg-amber-50 text-amber-900"
                                        : "border-slate-200 bg-slate-50 text-slate-700"
                                    }`}
                                  >
                                    <option value="">
                                      {isAmbiguous
                                        ? "Selecione: vincular existente ou criar nova..."
                                        : "Criar nova turma (se não existir)"}
                                    </option>
                                    <option value="__CREATE_NEW__">
                                      Criar nova turma: {cfg.customName}
                                    </option>
                                    {existingClassGroups.map((cg) => (
                                      <option key={cg.id} value={cg.id}>
                                        Vincular a: {cg.name} ({cg.shift || "MANHA"})
                                      </option>
                                    ))}
                                  </select>
                                  {isAmbiguous && (
                                    <p className="text-[10px] font-bold text-amber-800">
                                      Confirme o destino: selecione uma turma existente ou criar nova.
                                    </p>
                                  )}
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
                  consolidated.stats.activeStudentsCount === 0 ||
                  consolidated.turmasToImport.some((t) =>
                    isTurmaAmbiguousUnresolved(
                      t.tempId,
                      turmaConfigs[t.tempId],
                      ambiguousLineIds
                    )
                  )
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
