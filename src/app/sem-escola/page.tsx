import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ShieldAlert } from "lucide-react";
import { auth } from "@/lib/auth";
import { getAuthorizedCurrentSchool } from "@/lib/currentSchool";
import {
  isSnapshotSuperAdmin,
  resolveEffectiveSessionRoleWithoutSchool,
  resolveServerUserAuthSnapshot,
} from "@/lib/serverAuthContext";
import SignOutButton from "./SignOutButton";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Instituição não vinculada | Rede Ativa",
};

export default async function SemEscolaPage() {
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/login");
  }

  const snapshot = await resolveServerUserAuthSnapshot(session);
  if (!snapshot || snapshot.active === false) {
    redirect("/login?error=AccountInactive");
  }

  const authorizedSchool = await getAuthorizedCurrentSchool(session, snapshot.schoolId, snapshot);
  if (authorizedSchool) {
    redirect("/busca-ativa");
  }

  const isSuperAdmin = isSnapshotSuperAdmin(snapshot);
  const effectiveRole = resolveEffectiveSessionRoleWithoutSchool(snapshot);
  const canOnboard = isSuperAdmin || effectiveRole === "GESTAO_SECRETARIA";

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <section className="max-w-lg w-full bg-white rounded-3xl border border-slate-200 shadow-sm p-8 text-center space-y-5">
        <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-7 h-7" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-black text-slate-900">
            Nenhuma instituição ativa vinculada
          </h1>
          <p className="text-xs text-slate-600 leading-relaxed">
            Sua conta autenticada (<span className="font-mono font-semibold">{snapshot.email}</span>) não possui vínculo ativo com nenhuma unidade escolar no momento. Solicite à direção da escola ou à secretaria da rede a ativação do vínculo.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          {canOnboard && (
            <Link
              href="/onboarding"
              className="inline-flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition w-full sm:w-auto"
            >
              <Building2 className="w-4 h-4" />
              <span>Cadastrar instituição</span>
            </Link>
          )}

          <SignOutButton className="inline-flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition w-full sm:w-auto" />
        </div>
      </section>
    </main>
  );
}
