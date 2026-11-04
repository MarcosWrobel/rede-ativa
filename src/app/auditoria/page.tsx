import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkIsAdmin, checkIsSuperAdmin } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import AuditoriaClient from "./AuditoriaClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AuditoriaPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  if (!checkIsAdmin(session)) {
    redirect("/busca-ativa");
  }

  const isSuper = checkIsSuperAdmin(session);
  const sessionUser = session.user as any;
  const currentSchool = await getCurrentSchool(sessionUser?.schoolId);

  // SuperAdmin visualiza todo o ecossistema SaaS; Gestores veem a sua escola (incluindo logs históricos legados da unidade fundadora)
  const isDefaultSchoolContext =
    currentSchool.id === "default-leopoldina" ||
    currentSchool.inepCode === "41042730";

  const where = isSuper
    ? {}
    : isDefaultSchoolContext
    ? {
        OR: [
          { schoolId: currentSchool.id },
          { schoolId: null },
          { schoolId: "default-leopoldina" },
        ],
      }
    : { schoolId: currentSchool.id };

  const logs = await prisma.auditLog.findMany({
    where,
    take: 300,
    orderBy: { createdAt: "desc" },
  });

  return <AuditoriaClient initialLogs={logs} />;
}
