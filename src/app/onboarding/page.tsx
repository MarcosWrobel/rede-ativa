import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkIsSecretariat, checkIsSuperAdmin } from "@/lib/roles";
import OnboardingClient from "./OnboardingClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Wizard de Adesão e Auto-Onboarding | Rede Ativa SaaS",
  description:
    "Assistente guiado passo a passo para integração e adesão de novas escolas e redes de ensino à plataforma Rede Ativa SaaS.",
};

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const isSuper = checkIsSuperAdmin(session);
  const isSecretariat = checkIsSecretariat(session);

  // Apenas SuperAdmin ou Gestão de Secretaria de Educação podem provisionar novas escolas no SaaS
  if (!isSuper && !isSecretariat) {
    redirect("/");
  }

  const networks = await prisma.educationNetwork.findMany({
    select: {
      id: true,
      name: true,
      shortName: true,
      city: true,
      state: true,
      type: true,
    },
    orderBy: { name: "asc" },
  });

  const rawCities = await prisma.school.findMany({
    where: { active: true },
    select: { city: true },
    distinct: ["city"],
  });
  const existingCities = Array.from(new Set(rawCities.map((c) => c.city).filter(Boolean)));
  if (!existingCities.includes("Tibagi")) {
    existingCities.unshift("Tibagi");
  }

  return (
    <OnboardingClient
      user={{
        id: session.user.id || "",
        name: session.user.name || "Gestor Escolar",
        email: session.user.email || "",
      }}
      networks={networks}
      existingCities={existingCities}
      isSuperAdmin={isSuper}
    />
  );
}
