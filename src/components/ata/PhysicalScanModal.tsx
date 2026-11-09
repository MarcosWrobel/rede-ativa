"use client";

import { useState, useRef } from "react";
import {
  X,
  Camera,
  Upload,
  FileCheck2,
  Trash2,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  FileText,
  Image as ImageIcon,
} from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  minute: any;
  onSuccess: (updatedMinute: any) => void;
}

export default function PhysicalScanModal({
  isOpen,
  onClose,
  minute,
  onSuccess,
}: Props) {
  const [fileDataUrl, setFileDataUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [fileType, setFileType] = useState<"image" | "pdf">("image");
  const [isGovBr, setIsGovBr] = useState<boolean>(Boolean(minute?.govBrVerified));
  const [govBrProtocol, setGovBrProtocol] = useState<string>(minute?.govBrProtocol || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen || !minute) return null;

  const hasScan = Boolean(
    minute.hasPhysicalScan ||
    minute.physicalScanStorageKey ||
    (typeof minute.physicalSignedScanData === "string" && minute.physicalSignedScanData.length > 0) ||
    minute.physicalSignedScanData === true
  );
  const currentScanUrl = `/api/atas/${minute.id}/physical-scan`;
  const isCurrentPdf =
    minute.physicalScanMimeType === "application/pdf" ||
    (typeof minute.physicalSignedScanData === "string" &&
      (minute.physicalSignedScanData.startsWith("data:application/pdf") ||
       minute.physicalSignedScanData.startsWith("%PDF")));

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    if (file.size > 8 * 1024 * 1024) {
      setError("O arquivo selecionado deve ter no máximo 8MB.");
      return;
    }

    setFileName(file.name);
    const isPdf = file.type === "application/pdf" || file.name.endsWith(".pdf");
    setFileType(isPdf ? "pdf" : "image");

    const reader = new FileReader();
    reader.onload = () => {
      setFileDataUrl(reader.result as string);
    };
    reader.onerror = () => {
      setError("Erro ao ler o arquivo selecionado.");
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!fileDataUrl && !hasScan) {
      setError("Selecione ou fotografe a folha física da ata para anexar.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const validExistingScan = typeof minute.physicalSignedScanData === "string" ? minute.physicalSignedScanData : null;
      const payload = {
        scanData: fileDataUrl || validExistingScan,
        govBrVerified: isGovBr,
        govBrProtocol: govBrProtocol.trim() || null,
      };

      const res = await fetch(`/api/atas/${minute.id}/physical-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao salvar anexo da via física.");
      }

      onSuccess(data.minute);
      onClose();
    } catch (err: any) {
      setError(err.message || "Erro inesperado ao salvar via física.");
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm("Deseja realmente remover o anexo da via física desta ata?")) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/atas/${minute.id}/physical-scan`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao remover via física.");
      }

      onSuccess({
        ...minute,
        physicalSignedScanData: null,
        physicalScanUploadedAt: null,
        physicalScanUploadedBy: null,
        govBrVerified: false,
        govBrProtocol: null,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || "Erro ao remover anexo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Topo do Modal */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                Anexo de Via Física & Assinatura Gov.br
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Ata nº {minute.ataNumber ? String(minute.ataNumber).padStart(3, "0") : "S/N"}/{minute.year} — {minute.subject}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo com Scroll */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-700 dark:text-slate-300">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Estado Atual: Já possui anexo */}
          {hasScan && !fileDataUrl && (
            <div className="p-4 rounded-2xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-emerald-800 dark:text-emerald-300 font-bold">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Via Física Digitalizada Anexa</span>
                </div>
                {minute.physicalScanUploadedAt && (
                  <span className="text-[10px] text-slate-500 font-mono">
                    {new Date(minute.physicalScanUploadedAt).toLocaleDateString("pt-BR")}{" "}
                    {new Date(minute.physicalScanUploadedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </div>

              {minute.govBrVerified && (
                <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 font-bold text-[11px]">
                  <span>🏛️ Autenticado no Assinador Gov.br (ITI)</span>
                  {minute.govBrProtocol && (
                    <span className="font-mono text-[10px]">({minute.govBrProtocol})</span>
                  )}
                </div>
              )}

              {/* Preview */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-950 p-2 max-h-56 flex items-center justify-center">
                {isCurrentPdf ? (
                  <div className="flex flex-col items-center py-4 space-y-2">
                    <FileText className="w-10 h-10 text-rose-500" />
                    <span className="font-medium">Documento PDF da Ata Assinada</span>
                    <a
                      href={`${currentScanUrl}?download=1`}
                      download={`Ata_${minute.ataNumber}_${minute.year}_Assinada.pdf`}
                      className="inline-flex items-center space-x-1 text-sky-600 hover:underline font-bold"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Baixar PDF Anexo</span>
                    </a>
                  </div>
                ) : (
                  <img
                    src={currentScanUrl}
                    alt="Via Física da Ata Assinada"
                    className="max-h-52 object-contain rounded-lg"
                  />
                )}
              </div>

              {minute.physicalScanSha256 && (
                <p className="text-[10px] font-mono text-slate-500 truncate">
                  SHA-256: {minute.physicalScanSha256}
                </p>
              )}

              <div className="flex items-center justify-between pt-1">
                <span className="text-[10.5px] text-slate-500">
                  Digitalizado por: <strong>{minute.physicalScanUploadedBy || "Equipe Escolar"}</strong>
                </span>
                <button
                  type="button"
                  onClick={handleRemove}
                  disabled={loading}
                  className="inline-flex items-center space-x-1 text-rose-600 hover:text-rose-700 font-bold hover:underline"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remover / Substituir</span>
                </button>
              </div>
            </div>
          )}

          {/* Área de Seleção / Captura */}
          <div className="space-y-3">
            <div className="text-slate-600 dark:text-slate-400 font-medium leading-relaxed">
              Fotografe com o smartphone a via impressa assinada à mão pelos responsáveis ou anexe o arquivo PDF assinado eletronicamente via <strong>Gov.br (assinador.iti.br)</strong>.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Botão Câmera */}
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="flex items-center justify-center space-x-2 p-3.5 rounded-2xl border-2 border-dashed border-indigo-300 dark:border-indigo-700 hover:bg-indigo-50/60 dark:hover:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 font-bold transition cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Fotografar Folha</span>
              </button>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileSelect}
              />

              {/* Botão Upload Arquivo */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center space-x-2 p-3.5 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold transition cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>Escolher Imagem / PDF</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
          </div>

          {/* Pré-visualização do Novo Arquivo Selecionado */}
          {fileDataUrl && (
            <div className="p-3.5 rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-indigo-900 dark:text-indigo-200 flex items-center space-x-1.5">
                  {fileType === "image" ? <ImageIcon className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                  <span>{fileName || "Arquivo selecionado"}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setFileDataUrl(null);
                    setFileName("");
                  }}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {fileType === "image" ? (
                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white p-1 max-h-48 flex items-center justify-center">
                  <img src={fileDataUrl} alt="Preview" className="max-h-44 object-contain rounded" />
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 italic">Documento PDF pronto para envio.</p>
              )}
            </div>
          )}

          {/* Validação e Protocolo Gov.br */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
            <label className="flex items-center space-x-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={isGovBr}
                onChange={(e) => setIsGovBr(e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
              />
              <span className="font-bold text-slate-800 dark:text-slate-200">
                Documento assinado digitalmente no Gov.br (assinador.iti.br)
              </span>
            </label>

            {isGovBr && (
              <div className="pl-6.5 space-y-1">
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Código de Verificação / Protocolo ITI (opcional):
                </label>
                <input
                  type="text"
                  value={govBrProtocol}
                  onChange={(e) => setGovBrProtocol(e.target.value)}
                  placeholder="Ex.: ITI-2026-ABC12345"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </div>
        </div>

        {/* Rodapé com Ações */}
        <div className="flex items-center justify-end space-x-2.5 px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading || (!fileDataUrl && isGovBr === Boolean(minute?.govBrVerified) && govBrProtocol === (minute?.govBrProtocol || ""))}
            className="inline-flex items-center space-x-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold shadow-sm transition"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Salvando...</span>
              </>
            ) : (
              <>
                <FileCheck2 className="w-4 h-4" />
                <span>Salvar Anexo Oficial</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
