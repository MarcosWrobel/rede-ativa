import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getCurrentSchool } from "@/lib/currentSchool";
import { checkIsAdmin } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import EscolaSettingsClient from "./EscolaSettingsClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Identidade & Configurações da Escola | Gestão Escolar",
};

export default async function EscolaSettingsPage() {
  const session = await auth();
  const sessionUser = session?.user as any;

  if (!session?.user) {
    redirect("/login");
  }

  // Ensure Admin or School Manager permission (4-tier RBAC)
  if (!checkIsAdmin(session)) {
    redirect("/");
  }

  const currentSchool = await getCurrentSchool(sessionUser?.schoolId);
  if (!currentSchool) {
    redirect("/");
  }

  // Check if school has active sync token
  const schoolRecord = await prisma.school.findFirst({
    where: {
      OR: [{ id: currentSchool.id }, { inepCode: currentSchool.inepCode }],
    },
    select: {
      id: true,
      name: true,
      inepCode: true,
      network: true,
      city: true,
      state: true,
      nre: true,
      phone: true,
      email: true,
      logoUrl: true,
      syncTokenHash: true,
      updatedAt: true,
    },
  });

  const hasSyncToken = Boolean(schoolRecord?.syncTokenHash);
  const fullName = schoolRecord?.name || currentSchool.name;
  const shortName = fullName.replace(/^(Colégio Estadual|Escola Municipal|C\.E\.|E\.M\.)\s+/i, "");

  return (
    <EscolaSettingsClient
      school={{
        id: currentSchool.id,
        name: fullName,
        shortName,
        inep: schoolRecord?.inepCode || currentSchool.inepCode || "",
        network: (schoolRecord?.network as any) || currentSchool.network || "ESTADUAL",
        municipality: schoolRecord?.city || currentSchool.city,
        state: schoolRecord?.state || currentSchool.state,
        phone: schoolRecord?.phone || currentSchool.phone || "",
        email: schoolRecord?.email || currentSchool.email || "",
        address: "",
        logoUrl: schoolRecord?.logoUrl || currentSchool.logoUrl || "",
        hasSyncToken,
        syncTokenCreatedAt: schoolRecord?.updatedAt?.toISOString() || null,
      }}
    />
  );
}
