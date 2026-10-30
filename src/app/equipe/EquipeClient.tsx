"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  UserCheck,
  UserPlus,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Power,
  Loader2,
  Lock,
} from "lucide-react";
import { BOOTSTRAP_ADMIN_EMAIL } from "@/lib/roles";

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
}

export default function EquipeClient({ initialUsers, currentAdminEmail }: Props) {
  const [users, setUsers] = useState<TeamUser[]>(initialUsers);
  const [nameInput, setNameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [roleInput, setRoleInput] = useState<"PEDAGOGA" | "ADMIN">("PEDAGOGA");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; message: string } | null>(null);

  const formRef = useRef<HTMLFormElement>(null);

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
    const admins = users.filter((u) => u.active && u.role === "ADMIN").length;
    const inactive = total - active;
    return { total, active, admins, inactive };
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

      setUsers((prev) => [data, ...prev]);
      setNameInput("");
      setEmailInput("");
      setRoleInput("PEDAGOGA");
      formRef.current?.reset();
      setFeedback({
        type: "ok",
        message: `Acesso liberado para ${data.email} (${data.role}). Basta entrar com o Google @escola.`,
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
      setFeedback({
        type: "ok",
        message: `Permissões de ${data.name} (${data.email}) atualizadas com sucesso.`,
      });
    } catch (err: any) {
      setFeedback({ type: "err", message: err.message || "Falha ao atualizar usuário." });
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
            <UserCheck className="w-6 h-6 text-sky-600" />
            <span>Equipe Autorizada & Controle de Acesso (LGPD)</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Apenas servidores institucionais listados como <strong>Ativos</strong> abaixo conseguem acessar os dados dos estudantes do Colégio Leopoldina.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-semibold text-slate-500 uppercase">Total Cadastrados</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{stats.total}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-semibold text-slate-500 uppercase">Acessos Ativos</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">{stats.active}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-semibold text-slate-500 uppercase">Administradores</div>
          <div className="text-2xl font-bold text-sky-700 mt-1">{stats.admins}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-semibold text-slate-500 uppercase">Inativos / Revogados</div>
          <div className="text-2xl font-bold text-slate-400 mt-1">{stats.inactive}</div>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          role="status"
          className={`flex items-center space-x-2.5 p-3.5 rounded-xl border text-xs font-semibold ${
            feedback.type === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {feedback.type === "ok" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Pre-authorize New Staff Form */}
      <form
        ref={formRef}
        onSubmit={handleAddMember}
        className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-4"
      >
        <div className="flex items-center space-x-2 text-sm font-bold text-slate-900">
          <UserPlus className="w-4 h-4 text-sky-600" />
          <span>Pré-Autorizar Novo Membro da Equipe Escolar</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
          <div className="md:col-span-4">
            <label htmlFor="equipe-name" className="block text-xs font-bold text-slate-700 mb-1">
              Nome da Pedagoga / Servidor
            </label>
            <span className="block text-[11px] text-slate-500 mb-1.5">
              Ex.: Profª Ana Cláudia (atualizado no 1º login)
            </span>
            <input
              id="equipe-name"
              name="name"
              type="text"
              autoComplete="name"
              placeholder="Nome de exibição"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-sky-500/30"
            />
          </div>

          <div className="md:col-span-5 validated-field">
            <label htmlFor="equipe-email" className="block text-xs font-bold text-slate-700 mb-1">
              E-mail Institucional Obrigatório *
            </label>
            <span id="equipe-email-hint" className="block text-[11px] text-slate-500 mb-1.5">
              Formato exigido: nome.sobrenome@escola.pr.gov.br
            </span>
            <input
              id="equipe-email"
              name="email"
              type="email"
              required
              pattern=".+@escola\.pr\.gov\.br$"
              autoComplete="email"
              aria-describedby="equipe-email-hint"
              aria-errormessage="equipe-email-error"
              placeholder="servidor@escola.pr.gov.br"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-sky-500/30 font-mono"
            />
            <div
              id="equipe-email-error"
              className="field-error-msg items-center space-x-1 text-[11px] font-semibold text-red-600 mt-1.5"
            >
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
              <span>Informe um e-mail institucional válido terminado em @escola.pr.gov.br.</span>
            </div>
          </div>

          <div className="md:col-span-3">
            <label htmlFor="equipe-role" className="block text-xs font-bold text-slate-700 mb-1">
              Perfil de Acesso
            </label>
            <span className="block text-[11px] text-slate-500 mb-1.5">
              Nível de governança
            </span>
            <div className="flex items-center gap-2">
              <select
                id="equipe-role"
                value={roleInput}
                onChange={(e) => setRoleInput(e.target.value as "PEDAGOGA" | "ADMIN")}
                className="flex-1 px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white font-semibold"
              >
                <option value="PEDAGOGA">PEDAGOGA</option>
                <option value="ADMIN">ADMIN</option>
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
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div
          tabIndex={0}
          role="region"
          aria-labelledby="equipe-table-caption"
          className="equipe-table-wrapper"
        >
          <table className="w-full text-xs text-left">
            <caption id="equipe-table-caption" className="sr-only">
              Lista de membros da equipe escolar autorizados no sistema
            </caption>
            <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th scope="col" className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                  Servidor(a)
                </th>
                <th scope="col" className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                  E-mail @escola
                </th>
                <th scope="col" className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                  Perfil RBAC
                </th>
                <th scope="col" className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                  Envios / Retornos
                </th>
                <th scope="col" className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-right">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const emailNorm = u.email.toLowerCase().trim();
                const isProtected =
                  emailNorm === currentAdminEmail || emailNorm === BOOTSTRAP_ADMIN_EMAIL;
                const isBusy = updatingId === u.id;

                return (
                  <tr key={u.id} className="hover:bg-slate-50/70 transition">
                    <th scope="row" className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">
                      <div className="flex items-center space-x-2">
                        <span>{u.name}</span>
                        {emailNorm === currentAdminEmail && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-semibold">
                            Você
                          </span>
                        )}
                      </div>
                    </th>
                    <td className="px-4 py-3 font-mono text-sky-700 whitespace-nowrap">
                      {u.email}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {isProtected ? (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>ADMIN RAIZ</span>
                        </span>
                      ) : (
                        <select
                          aria-label={`Alterar perfil de ${u.name}`}
                          disabled={isBusy}
                          value={u.role === "ADMIN" ? "ADMIN" : "PEDAGOGA"}
                          onChange={(e) => handleUpdateUser(u, { role: e.target.value })}
                          className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white font-bold text-[11px] text-slate-700"
                        >
                          <option value="PEDAGOGA">PEDAGOGA</option>
                          <option value="ADMIN">ADMIN</option>
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      <span className="font-semibold text-slate-800">
                        {u._count?.messageLogs ?? 0}
                      </span>{" "}
                      envios •{" "}
                      <span className="text-emerald-700 font-semibold">
                        {u._count?.repliedLogs ?? 0}
                      </span>{" "}
                      retornos
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {u.active ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Ativo
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
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
                              ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          }`}
                        >
                          <Power className="w-3 h-3" />
                          <span>{u.active ? "Revogar Acesso" : "Reativar"}</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
