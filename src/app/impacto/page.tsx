import type { Metadata } from "next";
import ImpactoClient from "./ImpactoClient";

export const metadata: Metadata = {
  title: "Playground Interativo & Impacto Pedagógico | Rede Ativa SaaS",
  description:
    "Experimente em tempo real os simuladores de Busca Ativa com privacidade, Livro Digital de Atas com Fé Pública (Lei nº 14.063/2020) e emissão de Dossiê ECA em 30 segundos.",
  openGraph: {
    title: "Rede Ativa SaaS — Simulador de Impacto e Bancada Interativa",
    description:
      "A plataforma educacional desenhada no chão de escola que devolve até 80% do tempo da equipe e blinda a gestão escolar.",
    type: "website",
  },
};

export default function ImpactoPage() {
  return <ImpactoClient />;
}
