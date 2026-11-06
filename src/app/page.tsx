import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkIsSuperAdmin, checkIsSecretariat, checkIsSchoolManager } from "@/lib/roles";
import ImpactoClient from "./impacto/ImpactoClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rede Ativa SaaS — Plataforma Educacional de Busca Ativa & Livro de Atas",
  description:
    "A plataforma educacional desenhada no chão de escola que devolve até 80% do tempo da equipe pedagógica, automatiza a busca ativa e formaliza o Livro de Atas com Fé Pública (Lei nº 14.063/2020).",
  openGraph: {
    title: "Rede Ativa SaaS — Busca Ativa Escolar & Gestão Pedagógica",
    description:
      "Simulador interativo de impacto pedagógico, busca ativa inteligente e conformidade legal com o ECA para redes de ensino.",
    type: "website",
  },
};

export default async function RootDispatcherPage() {
  const session = await auth();

  // 1. Usuárias autenticadas são despachadas imediatamente para seus painéis de atuação
  if (session?.user && (session.user as any)?.active !== false) {
    if (checkIsSuperAdmin(session)) {
      redirect("/admin");
    }
    if (checkIsSecretariat(session)) {
      redirect("/secretaria");
    }
    if (checkIsSchoolManager(session)) {
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
