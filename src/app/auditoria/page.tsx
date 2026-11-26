import { prisma } from "@/lib/prisma";
import { resolveAuthorizedPageContext } from "@/lib/pageAuth";
import AuditoriaClient from "./AuditoriaClient";

export const dynamic = "force-dynamic";

export default async function AuditoriaPage() {
  const ctx = await resolveAuthorizedPageContext({ requireManager: true });
  const isSuper = ctx.isSuperAdmin;
  const currentSchool = ctx.school;

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
