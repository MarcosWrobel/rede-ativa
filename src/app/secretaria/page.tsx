import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkIsSecretariat, checkIsSuperAdmin } from "@/lib/roles";
import { buildSessionFromSnapshot, resolveServerUserAuthSnapshot } from "@/lib/serverAuthContext";
import {
  aggregateSecretariaMetrics,
  resolveSecretariaNetworkScope,
} from "@/lib/secretariaMetrics";
import SecretariaClient from "./SecretariaClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Painel da Secretaria Municipal de Educação | Gestão da Rede SEMEC",
};

interface Props {
  searchParams?: Promise<{ city?: string; networkId?: string }>;
}

export default async function SecretariaPage({ searchParams }: Props) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const snapshot = await resolveServerUserAuthSnapshot(session);
  if (!snapshot || snapshot.active === false) {
    redirect("/login?error=AccountInactive");
  }

  const freshSession = buildSessionFromSnapshot(session, snapshot);
  const isSuper = checkIsSuperAdmin(freshSession);
  const isSec = checkIsSecretariat(freshSession);

  if (!isSuper && !isSec) {
    redirect("/");
  }

  const { allowedNetworkIds, allowedCities } = await resolveSecretariaNetworkScope({
    isSuper,
    userId: snapshot.id,
    snapshot,
  });

  // Sem rede municipal vinculada por networkId ativo: renderiza estado vazio seguro sem fallback
  if (!isSuper && allowedNetworkIds.length === 0) {
    return (
      <SecretariaClient
        city="Nenhuma rede vinculada"
        availableCities={[]}
        metrics={{
          totalSchools: 0,
          totalStudents: 0,
          totalClasses: 0,
          criticalStudentsCount: 0,
          networkAverageAttendance: 100,
          messagesSentThisMonth: 0,
        }}
        initialSchools={[]}
        predictiveData={{
          totalCategorizedReplies: 0,
          criticalRate: 0,
          causesBreakdown: [],
          recommendations: [],
        }}
        isSuperAdmin={false}
        currentUser={{
          name: session.user.name || "Gestor SEMEC",
          email: session.user.email || "",
        }}
      />
    );
  }

  const requestedCity = resolvedSearchParams.city?.trim();
  const requestedNetworkId = resolvedSearchParams.networkId?.trim();
  const effectiveNetworkIdFilter =
    requestedNetworkId && (isSuper || allowedNetworkIds.includes(requestedNetworkId))
      ? requestedNetworkId
      : undefined;

  // Buscar cidades disponíveis na rede municipal (restrito estritamente aos networkIds autorizados para não-SuperAdmin)
  const availableMunicipalCities = await prisma.school.findMany({
    where: {
      active: true,
      network: "MUNICIPAL",
      ...(!isSuper ? { networkId: { in: allowedNetworkIds } } : {}),
    },
    select: { city: true },
    distinct: ["city"],
    orderBy: { city: "asc" },
  });
  const availableCities = Array.from(
    new Set(availableMunicipalCities.map((c) => c.city).filter(Boolean))
  );

  let defaultCity = requestedCity || allowedCities[0] || availableCities[0] || "";
  if (!isSuper && availableCities.length > 0) {
    const matchesAllowed = availableCities.some(
      (c) => c.toLowerCase() === defaultCity.toLowerCase()
    );
    if (!matchesAllowed) {
      defaultCity = availableCities[0];
    }
  } else if (!isSuper && allowedCities.length > 0) {
    const matchesAllowed = allowedCities.some(
      (c) => c.toLowerCase() === defaultCity.toLowerCase()
    );
    if (!matchesAllowed) {
      defaultCity = allowedCities[0];
    }
  }

  if (defaultCity && !availableCities.includes(defaultCity)) {
    availableCities.unshift(defaultCity);
  }

  if (!defaultCity && isSuper) {
    return (
      <SecretariaClient
        city="Nenhuma rede cadastrada"
        availableCities={[]}
        metrics={{
          totalSchools: 0,
          totalStudents: 0,
          totalClasses: 0,
          criticalStudentsCount: 0,
          networkAverageAttendance: 100,
          messagesSentThisMonth: 0,
        }}
        initialSchools={[]}
        predictiveData={{
          totalCategorizedReplies: 0,
          criticalRate: 0,
          causesBreakdown: [],
          recommendations: [],
        }}
        isSuperAdmin={isSuper}
        currentUser={{
          name: session.user.name || "Gestor SEMEC",
          email: session.user.email || "",
        }}
      />
    );
  }

  const aggregated = await aggregateSecretariaMetrics({
    isSuper,
    allowedNetworkIds,
    networkIdFilter: effectiveNetworkIdFilter,
    cityFilter: defaultCity || undefined,
  });

  return (
    <SecretariaClient
      city={defaultCity}
      availableCities={availableCities}
      metrics={aggregated.metrics}
      initialSchools={aggregated.schools}
      predictiveData={aggregated.predictiveAnalysis}
      isSuperAdmin={isSuper}
      currentUser={{
        name: session.user.name || "Gestor SEMEC",
        email: session.user.email || "",
      }}
    />
  );
}
