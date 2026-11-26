import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkIsSuperAdmin, checkIsSecretariat, checkIsSchoolManager } from "@/lib/roles";
import { buildSessionFromSnapshot, resolveServerUserAuthSnapshot } from "@/lib/serverAuthContext";
import ImpactoClient from "./impacto/ImpactoClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rede Ativa — Busca Ativa e Atas Pedagógicas",
  description:
    "Conecte os contatos com as famílias, os atendimentos e as atas em um único fluxo. Preparo de mensagens com supervisão humana e histórico contínuo por estudante.",
  openGraph: {
    title: "Rede Ativa — Busca Ativa e Atas Pedagógicas",
    description:
      "Ajuda a equipe pedagógica a preparar e enviar mensagens com supervisão humana, registrar intervenções e consultar o histórico de cada estudante.",
    type: "website",
  },
};

export default async function RootDispatcherPage() {
  const session = await auth();

  // 1. Usuárias autenticadas são validadas no banco antes do despacho para seus painéis
  if (session?.user && (session.user as any)?.active !== false) {
    const snapshot = await resolveServerUserAuthSnapshot(session);
    if (!snapshot || snapshot.active === false) {
      redirect("/login?error=AccountInactive");
    }
    const freshSession = buildSessionFromSnapshot(session, snapshot);
    if (checkIsSuperAdmin(freshSession)) {
      redirect("/admin");
    }
    if (checkIsSecretariat(freshSession)) {
      redirect("/secretaria");
    }
    if (checkIsSchoolManager(freshSession)) {
      redirect("/gestao");
    }
    redirect("/busca-ativa");
  }

  // 2. Para usuárias NÃO autenticadas:
  // Detecta o host da requisição para preservar compatibilidade com máquinas escolares legadas
  const headersList = await headers();
  const host = (headersList.get("x-forwarded-host") || headersList.get("host") || "").toLowerCase();

  // Máquinas institucionais acessando pelos domínios legados .vercel.app (ex: busca-ativa-leopoldina.vercel.app)
  // são direcionadas direto para /login para não quebrar webapps/PWAs e atalhos de desktop instalados
  if (host.includes(".vercel.app")) {
    redirect("/login");
  }

  // 3. No domínio oficial (redeativa.app.br / www.redeativa.app.br) ou ambiente local, renderiza a Landing Page
  return <ImpactoClient />;
}
