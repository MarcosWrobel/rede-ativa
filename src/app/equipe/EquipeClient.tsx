"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import {
  UserCheck,
  UserPlus,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Power,
  Loader2,
  Lock,
  Building2,
  Landmark,
  GraduationCap,
  Sparkles,
  Users,
  Globe,
} from "lucide-react";
import { BOOTSTRAP_ADMIN_EMAIL, ROLE_OPTIONS, getRoleOption, RoleLevel } from "@/lib/roles";

interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  createdAt: string | Date;
  _count?: {
    messageLogs: number;
    repliedLogs: number;
  };
}

interface Props {
  initialUsers: TeamUser[];
  currentAdminEmail: string;
  currentSchool: {
    id: string;
    name: string;
    inepCode: string;
    city: string;
    network?: string;
  };
  isSuperAdmin?: boolean;
  viewAll?: boolean;
}

export default function EquipeClient({
  initialUsers,
  currentAdminEmail,
  currentSchool,
  isSuperAdmin = false,
  viewAll = false,
}: Props) {
  const [users, setUsers] = useState<TeamUser[]>(initialUsers);
  const [nameInput, setNameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [roleInput, setRoleInput] = useState<RoleLevel>("PEDAGOGA");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; message: string } | null>(null);

  const formRef = useRef<HTMLFormElement>(null);

  // Sincroniza estado de usuários quando as props mudarem
  useEffect(() => {
    setUsers(initialUsers);
  }, [initialUsers]);

  // Sync aria-invalid + WeakMap fallback for :user-invalid
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;

    const supportsUserInvalid =
      typeof CSS !== "undefined" && CSS.supports("selector(:user-invalid)");
    const dirtyState = new WeakMap<HTMLInputElement, { interacted: boolean; blurred: boolean }>();

    const syncInputState = (el: EventTarget | null, eventType: string) => {
      if (!(el instanceof HTMLInputElement)) return;

      if (supportsUserInvalid) {
        el.setAttribute("aria-invalid", el.matches(":user-invalid") ? "true" : "false");
        return;
      }

      const st = dirtyState.get(el) || { interacted: false, blurred: false };
      if (eventType === "input" || eventType === "change") st.interacted = true;
      if (eventType === "blur") st.blurred = true;
      dirtyState.set(el, st);

      if (st.interacted && st.blurred) {
        const valid = el.checkValidity();
        el.classList.toggle("user-invalid-fallback", !valid);
        el.classList.toggle("user-valid-fallback", valid);
        el.setAttribute("aria-invalid", valid ? "false" : "true");
      }
    };

    const onBlur = (e: Event) => syncInputState(e.target, "blur");
    const onInput = (e: Event) => syncInputState(e.target, "input");

    form.addEventListener("blur", onBlur, true);
    form.addEventListener("input", onInput);
    return () => {
      form.removeEventListener("blur", onBlur, true);
      form.removeEventListener("input", onInput);
    };
  }, []);

  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter((u) => u.active).length;
    const admins = users.filter((u) => u.active && (u.role === "ADMIN" || u.role === "SUPERADMIN")).length;
    const managers = users.filter((u) => u.active && (u.role === "GESTAO_SECRETARIA" || u.role === "GESTOR_ESCOLAR")).length;
    const pedagogas = users.filter((u) => u.active && u.role === "PEDAGOGA").length;
    const inactive = total - active;
    return { total, active, admins, managers, pedagogas, inactive };
  }, [users]);

  const handleAddMember = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFeedback(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nameInput.trim(),
          email: emailInput.toLowerCase().trim(),
          role: roleInput,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Não foi possível autorizar o e-mail.");
      }

      setUsers((prev) => {
        const exists = prev.some((u) => u.id === data.id);
        if (exists) {
          return prev.map((u) => (u.id === data.id ? data : u));
        }
        return [data, ...prev];
      });

      const roleOpt = getRoleOption(data.role);
      setNameInput("");
      setEmailInput("");
      setRoleInput("PEDAGOGA");
      formRef.current?.reset();
      setFeedback({
        type: "ok",
        message: `Acesso liberado com sucesso para ${data.email} no perfil "${roleOpt.label}" em ${currentSchool.name}.`,
      });
    } catch (err: any) {
      setFeedback({ type: "err", message: err.message || "Erro ao adicionar membro." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateUser = async (
    user: TeamUser,
    patch: { role?: string; active?: boolean }
  ) => {
    setFeedback(null);
    setUpdatingId(user.id);
    try {
      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, ...patch }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao atualizar permissão.");
      }

      setUsers((prev) => prev.map((u) => (u.id === user.id ? data : u)));
      const roleOpt = getRoleOption(data.role);
      setFeedback({
        type: "ok",
        message: `Permissões de ${data.name} (${data.email}) atualizadas para "${roleOpt.label}".`,
      });
    } catch (err: any) {
      setFeedback({ type: "err", message: err.message || "Falha ao atualizar usuário." });
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & School Scope */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="inline-flex items-center space-x-2 bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 px-3 py-1 rounded-full text-xs font-bold border border-sky-200 dark:border-sky-800 mb-2">
            <Building2 className="w-3.5 h-3.5" />
            <span>Escola Ativa: {currentSchool.name}</span>
            <span className="text-sky-400">•</span>
            <span>INEP: {currentSchool.inepCode}</span>
          </div>

          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight flex items-center space-x-2">
            <UserCheck className="w-6 h-6 text-sky-600 dark:text-sky-400" />
            <span>Equipe Autorizada & Controle de Papéis</span>
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Gestão de acessos hierárquicos para servidores institucionais de{" "}
            <strong className="text-slate-800 dark:text-slate-200">{currentSchool.name}</strong>.
          </p>
        </div>

        {/* SuperAdmin View Mode Toggle */}
        {isSuperAdmin && (
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700">
            <Link
              href="/equipe"
              className={`px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition ${
                !viewAll
                  ? "bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Desta Escola</span>
            </Link>
            <Link
              href="/equipe?view=all"
              className={`px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition ${
                viewAll
                  ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Todas as Escolas (Global)</span>
            </Link>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">
            {viewAll ? "Total no SaaS" : "Equipe da Escola"}
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{stats.total}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{stats.active} ativos</div>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">
            Direção / Gestão
          </div>
          <div className="text-2xl font-bold text-sky-600 dark:text-sky-400 mt-1">{stats.managers}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Gestores SEMEC e Diretores</div>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">
            Equipe Pedagógica
          </div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{stats.pedagogas}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Acesso operacional</div>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">
            Administradores
          </div>
          <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">{stats.admins}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Acesso geral / SaaS</div>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          role="status"
          className={`flex items-center space-x-2.5 p-3.5 rounded-xl border text-xs font-semibold ${
            feedback.type === "ok"
              ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
              : "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300"
          }`}
        >
          {feedback.type === "ok" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Pre-authorize New Staff Form */}
      <form
        ref={formRef}
        onSubmit={handleAddMember}
        className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-4"
      >
        <div className="flex items-center space-x-2 text-sm font-bold text-slate-900 dark:text-white">
          <UserPlus className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          <span>Vincular / Autorizar Novo Membro na Escola ({currentSchool.name})</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
          <div className="md:col-span-4">
            <label htmlFor="equipe-name" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Nome do Servidor / Profissional
            </label>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">
              Ex.: Profª Ana Cláudia
            </span>
            <input
              id="equipe-name"
              name="name"
              type="text"
              autoComplete="name"
              placeholder="Nome de exibição"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 outline-none focus:ring-2 focus:ring-sky-500/30"
            />
          </div>

          <div className="md:col-span-5 validated-field">
            <label htmlFor="equipe-email" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              E-mail Institucional Obrigatório *
            </label>
            <span id="equipe-email-hint" className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">
              Institucional: @escola.pr.gov.br, @tibagi.pr.gov.br, .gov.br ou .edu.br
            </span>
            <input
              id="equipe-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              aria-describedby="equipe-email-hint"
              placeholder="servidor@escola.pr.gov.br ou @tibagi.pr.gov.br"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 outline-none focus:ring-2 focus:ring-sky-500/30 font-mono"
            />
          </div>

          <div className="md:col-span-3">
            <label htmlFor="equipe-role" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Posição / Perfil
            </label>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">
              Nível na hierarquia
            </span>
            <div className="flex items-center gap-2">
              <select
                id="equipe-role"
                value={roleInput}
                onChange={(e) => setRoleInput(e.target.value as RoleLevel)}
                className="flex-1 px-2.5 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 font-semibold text-slate-800 dark:text-slate-200"
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-bold shadow-2xs transition flex items-center space-x-1.5 whitespace-nowrap cursor-pointer"
              >
                {isSubmitting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <UserPlus className="w-3.5 h-3.5" />
                )}
                <span>Autorizar</span>
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Responsive Team Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
            {viewAll
              ? "Catálogo Global de Usuários (Todas as Unidades)"
              : `Membros com Vínculo em: ${currentSchool.name}`}
          </span>
          <span className="text-[11px] text-slate-400">
            {users.length} {users.length === 1 ? "membro cadastrado" : "membros cadastrados"}
          </span>
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-labelledby="equipe-table-caption"
          className="equipe-table-wrapper overflow-x-auto"
        >
          <table className="w-full text-xs text-left">
            <caption id="equipe-table-caption" className="sr-only">
              Lista de usuários autorizados na instituição
            </caption>
            <thead className="text-[11px] text-slate-500 uppercase bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th scope="col" className="px-4 py-3">Servidor</th>
                <th scope="col" className="px-4 py-3">E-mail Institucional</th>
                <th scope="col" className="px-4 py-3">Posição / Perfil</th>
                <th scope="col" className="px-4 py-3">Atividade</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-500 text-xs">
                    Nenhum membro vinculado a esta escola ainda. Utilize o formulário acima para adicionar o primeiro servidor.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const emailNorm = u.email.toLowerCase().trim();
                  const isProtected =
                    emailNorm === currentAdminEmail || emailNorm === BOOTSTRAP_ADMIN_EMAIL;
                  const isBusy = updatingId === u.id;
                  const currentRoleOpt = getRoleOption(u.role);

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                      <th scope="row" className="px-4 py-3 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <span>{u.name}</span>
                          {emailNorm === currentAdminEmail && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 font-semibold">
                              Você
                            </span>
                          )}
                        </div>
                      </th>
                      <td className="px-4 py-3 font-mono text-sky-700 dark:text-sky-400 whitespace-nowrap">
                        {u.email}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {isProtected ? (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>Admin (Meu acesso)</span>
                          </span>
                        ) : (
                          <select
                            aria-label={`Alterar perfil de ${u.name}`}
                            disabled={isBusy}
                            value={currentRoleOpt.value}
                            onChange={(e) => handleUpdateUser(u, { role: e.target.value })}
                            className={`px-2.5 py-1 rounded-lg border font-bold text-[11px] cursor-pointer transition ${currentRoleOpt.badgeClass}`}
                          >
                            {ROLE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {u._count?.messageLogs ?? 0}
                        </span>{" "}
                        envios •{" "}
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                          {u._count?.repliedLogs ?? 0}
                        </span>{" "}
                        retornos
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {u.active ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            Ativo
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                            Revogado
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {isProtected ? (
                          <span className="inline-flex items-center space-x-1 text-[11px] text-slate-400 font-medium">
                            <Lock className="w-3.5 h-3.5" />
                            <span>Protegido</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleUpdateUser(u, { active: !u.active })}
                            className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                              u.active
                                ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
                                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
                            }`}
                          >
                            <Power className="w-3 h-3" />
                            <span>{u.active ? "Revogar Acesso" : "Reativar"}</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
