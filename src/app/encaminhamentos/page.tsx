import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/rlsTenantContext";
import { resolveAuthorizedPageContext } from "@/lib/pageAuth";
import { canAccessConfidentialMinute } from "@/lib/ataCrypto";
import EncaminhamentosClient from "./EncaminhamentosClient";

export const dynamic = "force-dynamic";

export default async function EncaminhamentosPage() {
  const ctx = await resolveAuthorizedPageContext();
  const session = ctx.session;
  const school = ctx.school;

  const now = new Date();
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  const startOfTodayBrasilia = new Date(`${todayStr}T00:00:00.000-03:00`);

  const in7Days = new Date(startOfTodayBrasilia);
  in7Days.setDate(in7Days.getDate() + 7);

  let actionItems: any[] = [];
  let allSchoolActions: any[] = [];
  let classes: any[] = [];

  try {
    const { rawItems, rawSummaryItems, rawClasses } = await withTenantContext(
      prisma,
      school.id,
      async (tx) => {
        const items = await tx.pedagogicalActionItem.findMany({
          where: {
            minute: {
              schoolId: school.id,
              status: { in: ["FINALIZED", "DRAFT"] },
            },
          },
          take: 150,
          orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
          include: {
            minute: {
              select: {
                id: true,
                schoolId: true,
                ataNumber: true,
                year: true,
                subject: true,
                attendedAt: true,
                finalizedAt: true,
                status: true,
                isConfidential: true,
                authorId: true,
                authorEmail: true,
                students: {
                  select: {
                    id: true,
                    studentId: true,
                    studentNameSnapshot: true,
                    classNameSnapshot: true,
                    cgmSnapshot: true,
                    student: {
                      select: {
                        id: true,
                        name: true,
                        classGroup: { select: { id: true, name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        });
        const summaryItems = await tx.pedagogicalActionItem.findMany({
          where: {
            minute: { schoolId: school.id, status: { in: ["FINALIZED", "DRAFT"] } },
          },
          select: {
            id: true,
            status: true,
            dueDate: true,
            responsible: true,
            minute: {
              select: {
                schoolId: true,
                isConfidential: true,
                authorId: true,
                authorEmail: true,
              },
            },
          },
        });
        const cgList = await tx.classGroup.findMany({
          where: { schoolId: school.id },
          select: { id: true, name: true, shift: true },
          orderBy: { name: "asc" },
        });
        return { rawItems: items, rawSummaryItems: summaryItems, rawClasses: cgList };
      }
    );
    actionItems = (rawItems || []).filter(
      (item: any) => !item.minute || canAccessConfidentialMinute(item.minute, session)
    );
    allSchoolActions = (rawSummaryItems || []).filter(
      (item: any) => !item.minute || canAccessConfidentialMinute(item.minute, session)
    );
    classes = rawClasses || [];
  } catch (err) {
    console.error("[EncaminhamentosPage] Erro ao carregar compromissos:", err);
  }

  let total = allSchoolActions.length;
  let completed = 0;
  let pending = 0;
  let overdue = 0;
  let dueSoon = 0;

  for (const a of allSchoolActions) {
    if (a.status === "COMPLETED") {
      completed++;
    } else {
      pending++;
      if (a.dueDate) {
        const due = new Date(a.dueDate);
        if (due < startOfTodayBrasilia) {
          overdue++;
        } else if (due <= in7Days) {
          dueSoon++;
        }
      }
    }
  }

  return (
    <EncaminhamentosClient
      initialActionItems={actionItems}
      initialMetrics={{
        total,
        completed,
        pending,
        overdue,
        dueSoon,
      }}
      classes={classes}
      todayStr={todayStr}
    />
  );
}
