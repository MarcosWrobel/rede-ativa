import { signIn } from "@/lib/auth";
import { GraduationCap, ShieldCheck, Mail, ArrowRight, AlertCircle } from "lucide-react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) {
    redirect("/busca-ativa");
  }

  const hasGoogleAuth = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );

  const devUsers = [
    { name: "Marcos Wrobel", email: "marcos.wrobel@escola.pr.gov.br", role: "ADMIN (Resp. Técnico)" },
    { name: "Andreia", email: "andreia@escola.pr.gov.br", role: "Pedagoga (Fundamental)" },
    { name: "Ana Cecília", email: "ana.cecilia@escola.pr.gov.br", role: "Pedagoga (Fundamental/Médio)" },
    { name: "Jaqueline Lopes", email: "jaqueline.lopes@escola.pr.gov.br", role: "Pedagoga (Médio)" },
    { name: "Nathaly R.", email: "nathaly.r@escola.pr.gov.br", role: "Pedagoga (Médio)" },
    { name: "Natiele", email: "natiele@escola.pr.gov.br", role: "Pedagoga (Noturno)" },
  ];

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-sky-700 to-sky-600 p-8 text-white text-center">
          <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-xs border border-white/20">
            <GraduationCap className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Colégio Estadual Leopoldina</h1>
          <p className="text-sky-100 text-sm mt-1">Sistema de Busca Ativa & Comunicação Escolar</p>
        </div>

        <div className="p-8 space-y-6">
          {/* Security Banner */}
          <div className="flex items-start space-x-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900">
            <ShieldCheck className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Protegido por Autenticação Institucional</p>
              <p className="mt-0.5 text-amber-800">
                Acesso restrito a contas autorizadas <strong>@escola.pr.gov.br</strong>.
              </p>
            </div>
          </div>

          {/* Google Login Form */}
          {hasGoogleAuth ? (
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/busca-ativa" });
              }}
            >
              <button
                type="submit"
                className="w-full flex items-center justify-center space-x-3 py-3 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold shadow-sm hover:shadow transition"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>Entrar com Google @escola</span>
              </button>
            </form>
          ) : (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-sky-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-slate-800">Modo de Homologação Institucional Ativo</p>
                <p className="mt-0.5 text-slate-500">
                  Selecione seu perfil institucional abaixo para entrar no sistema. As credenciais do Google Cloud podem ser vinculadas a qualquer momento.
                </p>
              </div>
            </div>
          )}

          {/* Institutional Fast Selector */}
          <div className="pt-2 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5 text-center">
              Selecione sua conta institucional para acessar:
            </p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {devUsers.map((u) => (
                <form
                  key={u.email}
                  action={async () => {
                    "use server";
                    await signIn("escola-dev-auth", {
                      email: u.email,
                      redirectTo: "/busca-ativa",
                    });
                  }}
                >
                  <button
                    type="submit"
                    className="w-full flex items-center justify-between p-2.5 rounded-xl border border-slate-200 hover:border-sky-400 hover:bg-sky-50 text-left transition group shadow-2xs"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-800 group-hover:text-sky-700">
                        {u.name}
                      </div>
                      <div className="text-[11px] text-slate-500">{u.role}</div>
                      <div className="text-[10px] text-sky-600 font-mono">{u.email}</div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-sky-600 transition" />
                  </button>
                </form>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
