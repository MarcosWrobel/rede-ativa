"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Users,
  Search,
  Plus,
  Edit,
  Trash2,
  ChevronLeft,
  ChevronRight,
  FileText,
  FileSpreadsheet,
  UserCheck,
  Stethoscope,
  PhoneOff,
} from "lucide-react";
import ModalDialog from "@/components/ModalDialog";
import SereImportModal from "./SereImportModal";
import { getActiveJustification } from "@/lib/pedagogicalClassifier";

interface Props {
  initialStudents: any[];
  classGroups: any[];
  isAdmin?: boolean;
}

export default function AlunosClient({
  initialStudents,
  classGroups,
  isAdmin = false,
}: Props) {
  const [students, setStudents] = useState<any[]>(initialStudents);
  const [classGroupList, setClassGroupList] = useState<any[]>(classGroups);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSegment, setSelectedSegment] = useState("TODOS");
  const [selectedTurma, setSelectedTurma] = useState("");
  const [onlyMissingPhone, setOnlyMissingPhone] = useState(false);

  // SERE Batch Import Modal
  const [isSereModalOpen, setIsSereModalOpen] = useState(false);

  // Add/Edit Individual Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<any>(null);
  const [formCgm, setFormCgm] = useState("");
  const [formName, setFormName] = useState("");
  const [formGuardian, setFormGuardian] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formClassId, setFormClassId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const missingPhoneTotal = useMemo(
    () => students.filter((s) => !s.phone).length,
    [students]
  );

  const filteredStudents = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return students.filter((s) => {
      const matchSearch =
        !searchTerm ||
        s.name.toLowerCase().includes(q) ||
        (s.cgm && s.cgm.toLowerCase().includes(q)) ||
        (s.guardianName && s.guardianName.toLowerCase().includes(q)) ||
        (s.phone && s.phone.includes(searchTerm));

      const matchSegment =
        selectedSegment === "TODOS" || s.classGroup.segment === selectedSegment;

      const matchTurma = !selectedTurma || s.classGroupId === selectedTurma;

      const matchMissingPhone = !onlyMissingPhone || !s.phone;

      return matchSearch && matchSegment && matchTurma && matchMissingPhone;
    });
  }, [students, searchTerm, selectedSegment, selectedTurma, onlyMissingPhone]);

  const totalPages = Math.ceil(filteredStudents.length / pageSize) || 1;
  const paginatedStudents = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredStudents.slice(start, start + pageSize);
  }, [filteredStudents, page, pageSize]);

  const openCreateModal = () => {
    setEditingStudent(null);
    setFormCgm("");
    setFormName("");
    setFormGuardian("");
    setFormPhone("");
    setFormClassId(classGroupList[0]?.id || "");
    setFormError("");
    setIsModalOpen(true);
  };

  const openEditModal = (s: any) => {
    setEditingStudent(s);
    setFormCgm(s.cgm || "");
    setFormName(s.name);
    setFormGuardian(s.guardianName || "");
    setFormPhone(s.phone || "");
    setFormClassId(s.classGroupId);
    setFormError("");
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName || !formClassId || (!editingStudent && !formPhone)) {
      setFormError("Nome, turma e telefone são obrigatórios.");
      return;
    }

    setIsSubmitting(true);
    setFormError("");

    try {
      if (editingStudent) {
        const res = await fetch("/api/students", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingStudent.id,
            cgm: formCgm || null,
            name: formName,
            guardianName: formGuardian,
            phone: formPhone,
            classGroupId: formClassId,
          }),
        });
        const updated = await res.json();
        if (!res.ok) throw new Error(updated.error || "Erro ao atualizar");
        setStudents((prev) =>
          prev.map((s) =>
            s.id === updated.id
              ? {
                  ...updated,
                  justifications: s.justifications,
                  extraContactsCount: s.extraContactsCount,
                }
              : s
          )
        );
      } else {
        const res = await fetch("/api/students", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cgm: formCgm || null,
            name: formName,
            guardianName: formGuardian,
            phone: formPhone,
            classGroupId: formClassId,
          }),
        });
        const created = await res.json();
        if (!res.ok) throw new Error(created.error || "Erro ao cadastrar");
        setStudents((prev) => [
          { ...created, justifications: [], extraContactsCount: 0 },
          ...prev,
        ]);
      }
      setIsModalOpen(false);
    } catch (err: any) {
      setFormError(err.message || "Erro ao processar dados");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Tem certeza que deseja inativar o aluno ${name}?`)) return;
    try {
      const res = await fetch(`/api/students?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setStudents((prev) => prev.filter((s) => s.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Title & Action buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
            <Users className="w-6 h-6 text-sky-600" />
            <span>Cadastro & Prontuário 360º de Alunos</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {students.length} alunos ativos em {classGroupList.length} turmas. Clique no nome ou em{" "}
            <strong>Prontuário</strong> para gerenciar múltiplos contatos, atestados, atas presenciais e emitir o Dossiê PDF.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsSereModalOpen(true)}
            className="inline-flex items-center space-x-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Importar Lote (SERE)</span>
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center space-x-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            <span>Cadastrar Novo Aluno</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar por nome, CGM, responsável ou fone..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
            />
          </div>

          <select
            value={selectedSegment}
            onChange={(e) => {
              setSelectedSegment(e.target.value);
              setSelectedTurma("");
              setPage(1);
            }}
            className="border border-slate-300 rounded-lg p-2 bg-slate-50 focus:bg-white"
          >
            <option value="TODOS">Todos os Níveis</option>
            <option value="FUNDAMENTAL">Ensino Fundamental</option>
            <option value="MEDIO">Ensino Médio</option>
            <option value="NOTURNO">Ensino Noturno</option>
          </select>

          <select
            value={selectedTurma}
            onChange={(e) => {
              setSelectedTurma(e.target.value);
              setPage(1);
            }}
            className="border border-slate-300 rounded-lg p-2 bg-slate-50 focus:bg-white"
          >
            <option value="">Todas as Turmas</option>
            {classGroupList
              .filter(
                (cg) => selectedSegment === "TODOS" || cg.segment === selectedSegment
              )
              .map((cg) => (
                <option key={cg.id} value={cg.id}>
                  {cg.name}
                </option>
              ))}
          </select>
        </div>

        {missingPhoneTotal > 0 && (
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
            <span className="text-amber-800 flex items-center gap-1.5 font-medium">
              <PhoneOff className="w-3.5 h-3.5 text-amber-600" />
              <span>
                Há <strong>{missingPhoneTotal}</strong> aluno(s) sem telefone informado no SERE.
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                setOnlyMissingPhone((v) => !v);
                setPage(1);
              }}
              className={`px-3 py-1 rounded-lg font-bold transition ${
                onlyMissingPhone
                  ? "bg-amber-600 text-white"
                  : "bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200"
              }`}
            >
              {onlyMissingPhone ? "Mostrar Todos os Alunos" : "Filtrar Sem Telefone"}
            </button>
          </div>
        )}
      </div>

      {/* Students Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Nome do Aluno / CGM</th>
                <th className="px-4 py-3">Turma</th>
                <th className="px-4 py-3">Nível</th>
                <th className="px-4 py-3">Responsável</th>
                <th className="px-4 py-3">Telefone WhatsApp</th>
                <th className="px-4 py-3 text-center">Envios</th>
                <th className="px-4 py-3 text-right">Prontuário & Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedStudents.map((st) => {
                const activeJust = getActiveJustification(st.justifications);
                return (
                  <tr key={st.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link
                          href={`/alunos/${st.id}`}
                          className="font-bold text-slate-900 hover:text-sky-700 hover:underline"
                        >
                          {st.name}
                        </Link>
                        {activeJust && (
                          <span
                            title={`Atestado vigente até ${new Date(activeJust.endDate).toLocaleDateString("pt-BR")}`}
                            className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] border border-emerald-200"
                          >
                            <Stethoscope className="w-3 h-3" />
                            <span>Atestado Vigente</span>
                          </span>
                        )}
                      </div>
                      {st.cgm && (
                        <span className="text-[10px] font-mono text-slate-400">
                          CGM: {st.cgm}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-medium">{st.classGroup.name}</td>
                    <td className="px-4 py-3 text-slate-500">{st.classGroup.segment}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {st.guardianName || "—"}
                      {st.extraContactsCount > 0 && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 text-[10px] font-bold">
                          +{st.extraContactsCount} contato(s)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700">
                      {st.phone ? (
                        st.phone
                      ) : (
                        <button
                          type="button"
                          onClick={() => openEditModal(st)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-900 font-sans font-bold text-[10px] transition"
                          title="Clique para informar um telefone de contato"
                        >
                          <PhoneOff className="w-3 h-3" />
                          <span>Informar fone</span>
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-sky-700">
                      {st._count?.messageLogs || 0}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                      <Link
                        href={`/alunos/${st.id}`}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 font-bold text-[11px] transition"
                        title="Abrir Prontuário 360º do Aluno"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Prontuário</span>
                      </Link>
                      <Link
                        href={`/alunos/${st.id}/dossie`}
                        className="inline-flex items-center space-x-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] transition"
                        title="Emitir Dossiê Oficial em PDF"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>PDF</span>
                      </Link>
                      <button
                        type="button"
                        onClick={() => openEditModal(st)}
                        className="p-1.5 text-slate-400 hover:text-sky-600 transition align-middle"
                        title="Editar cadastro básico"
                      >
                        <Edit className="w-3.5 h-3.5 inline" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(st.id, st.name)}
                        className="p-1.5 text-slate-400 hover:text-red-600 transition align-middle"
                        title="Inativar aluno transferido"
                      >
                        <Trash2 className="w-3.5 h-3.5 inline" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {paginatedStudents.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    Nenhum aluno encontrado com os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <div>
            Página <strong>{page}</strong> de <strong>{totalPages}</strong>
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded border border-slate-300 bg-white disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded border border-slate-300 bg-white disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Add / Edit Individual Modal */}
      <ModalDialog
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingStudent ? "Editar Dados do Aluno" : "Cadastrar Novo Aluno"}
      >
        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          {formError && (
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="font-semibold text-slate-700 block mb-1">
                Nome Completo do Aluno (em maiúsculas):
              </label>
              <input
                type="text"
                required
                autoFocus
                placeholder="EX: JOÃO DA SILVA"
                value={formName}
                onChange={(e) => setFormName(e.target.value.toUpperCase())}
                className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white uppercase"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                CGM (Opcional):
              </label>
              <input
                type="text"
                placeholder="Ex: 1018613740"
                value={formCgm}
                onChange={(e) => setFormCgm(e.target.value.replace(/\D/g, ""))}
                className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white font-mono"
              />
            </div>
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">
              Turma:
            </label>
            <select
              required
              value={formClassId}
              onChange={(e) => setFormClassId(e.target.value)}
              className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
            >
              {classGroupList.map((cg) => (
                <option key={cg.id} value={cg.id}>
                  {cg.name} ({cg.segment})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">
              Nome do Responsável:
            </label>
            <input
              type="text"
              placeholder="Ex: Maria da Silva (Mãe)"
              value={formGuardian}
              onChange={(e) => setFormGuardian(e.target.value)}
              className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
            />
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">
              Telefone de Contato (com DDD, somente dígitos):
            </label>
            <input
              type="tel"
              required={!editingStudent}
              placeholder="Ex: 42998765432"
              value={formPhone}
              onChange={(e) => setFormPhone(e.target.value.replace(/\D/g, ""))}
              className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white font-mono"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold shadow-xs"
            >
              {isSubmitting ? "Gravando..." : "Salvar Aluno"}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* SERE Batch Import Modal */}
      <SereImportModal
        open={isSereModalOpen}
        onClose={() => setIsSereModalOpen(false)}
        existingClassGroups={classGroupList}
        isAdmin={isAdmin}
        onImportComplete={({ students: nextStudents, classGroups: nextGroups, filterMissingPhone }) => {
          setStudents(nextStudents);
          setClassGroupList(nextGroups);
          if (filterMissingPhone) {
            setOnlyMissingPhone(true);
            setSelectedSegment("TODOS");
            setSelectedTurma("");
            setSearchTerm("");
            setPage(1);
          }
        }}
      />
    </div>
  );
}
