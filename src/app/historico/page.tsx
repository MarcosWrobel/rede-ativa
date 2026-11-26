import { prisma } from "@/lib/prisma";
import { resolveAuthorizedPageContext } from "@/lib/pageAuth";
import HistoricoClient from "./HistoricoClient";

export const dynamic = "force-dynamic";

const INITIAL_PAGE_SIZE = 30;

export default async function HistoricoPage() {
  const ctx = await resolveAuthorizedPageContext();
  const session = ctx.session;
  const currentSchool = ctx.school;
  const schoolId = currentSchool.id;
  const isAdmin = ctx.isSchoolManager;

  let logs: any[] = [];
  let totalCount = 0;
  let classGroups: any[] = [];
  let pedagogaRows: any[] = [];

  try {
    const results = await Promise.all([
      prisma.messageLog.findMany({
        where: { student: { schoolId } },
        take: INITIAL_PAGE_SIZE,
        orderBy: { sentAt: "desc" },
        include: {
          student: {
            include: { classGroup: true },
          },
        },
      }),
      prisma.messageLog.count({
        where: { student: { schoolId } },
      }),
      prisma.classGroup.findMany({
        where: { schoolId },
        orderBy: { name: "asc" },
      }),
      prisma.messageLog.findMany({
        where: { student: { schoolId } },
        distinct: ["sentByName"],
        select: { sentByName: true },
        orderBy: { sentByName: "asc" },
      }),
    ]);
    logs = results[0] || [];
    totalCount = results[1] || 0;
    classGroups = results[2] || [];
    pedagogaRows = results[3] || [];
  } catch (err) {
    console.error("[HistoricoPage] Erro ao carregar histórico:", err);
  }

  const pedagogas = pedagogaRows
    .map((r) => r.sentByName)
    .filter((name): name is string => Boolean(name && name.trim()));

  return (
    <HistoricoClient
      initialLogs={logs}
      initialTotal={totalCount}
      pedagogas={pedagogas}
      classGroups={classGroups}
      currentUser={{
        name: session.user.name || "Pedagoga",
        email: session.user.email || "",
        role: ctx.effectiveRole || (isAdmin ? "GESTOR_ESCOLAR" : "PEDAGOGA"),
        isAdmin,
      }}
    />
  );
}
