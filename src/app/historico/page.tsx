import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/rlsTenantContext";
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
    const scopedMessageWhere = {
      OR: [{ schoolId: null }, { schoolId }],
      student: {
        schoolId,
        classGroup: { schoolId },
      },
    };
    await withTenantContext(prisma, schoolId, async (tx) => {
      logs =
        (await tx.messageLog.findMany({
          where: scopedMessageWhere,
          take: INITIAL_PAGE_SIZE,
          orderBy: { sentAt: "desc" },
          include: {
            student: {
              include: { classGroup: true },
            },
          },
        })) || [];
      totalCount =
        (await tx.messageLog.count({
          where: scopedMessageWhere,
        })) || 0;
      classGroups =
        (await tx.classGroup.findMany({
          where: { schoolId },
          orderBy: { name: "asc" },
        })) || [];
      pedagogaRows =
        (await tx.messageLog.findMany({
          where: scopedMessageWhere,
          distinct: ["sentByName"],
          select: { sentByName: true },
          orderBy: { sentByName: "asc" },
        })) || [];
    });
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
