import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import { classifyActionItemCategory } from "@/lib/actionClassifier";
import { canAccessConfidentialMinute } from "@/lib/ataCrypto";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const school = await getCurrentSchool(authCheck.session?.user?.schoolId);

    const now = new Date();
    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
    const startOfToday = new Date(`${todayStr}T00:00:00.000-03:00`);
    const endOfToday = new Date(`${todayStr}T23:59:59.999-03:00`);

    const in7Days = new Date(startOfToday);
    in7Days.setDate(in7Days.getDate() + 7);

    const pendingActions = await prisma.pedagogicalActionItem.findMany({
      where: {
        status: "PENDING",
        minute: {
          schoolId: school.id,
          status: { in: ["FINALIZED", "DRAFT"] },
        },
      },
      orderBy: [
        { dueDate: "asc" },
        { createdAt: "desc" },
      ],
      take: 200,
      include: {
        minute: {
          select: {
            id: true,
            schoolId: true,
            isConfidential: true,
            authorId: true,
            authorEmail: true,
            ataNumber: true,
            year: true,
            subject: true,
            attendedAt: true,
            students: {
              select: {
                studentId: true,
                studentNameSnapshot: true,
                classNameSnapshot: true,
                student: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                    contacts: {
                      select: {
                        name: true,
                        phone: true,
                        kinship: true,
                        isPrimary: true,
                        whatsappValid: true,
                      },
                      take: 2,
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const visiblePendingActions = pendingActions.filter((item) =>
      canAccessConfidentialMinute(item.minute as any, authCheck.session)
    );

    let overdueCount = 0;
    let dueTodayCount = 0;
    let dueSoonCount = 0;

    const criticalItems = visiblePendingActions.map((item) => {
      let urgency: "OVERDUE" | "DUE_TODAY" | "DUE_SOON" | "NORMAL" = "NORMAL";
      let daysDiff: number | null = null;

      if (item.dueDate) {
        const due = new Date(item.dueDate);
        const diffMs = due.getTime() - startOfToday.getTime();
        daysDiff = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        if (due < startOfToday) {
          urgency = "OVERDUE";
          overdueCount++;
        } else if (due <= endOfToday) {
          urgency = "DUE_TODAY";
          dueTodayCount++;
        } else if (due <= in7Days) {
          urgency = "DUE_SOON";
          dueSoonCount++;
        }
      }

      const classification = classifyActionItemCategory(item.description);

      // Identifica o telefone preferencial de contato familiar para envio rápido de lembrete
      const firstStudent = item.minute.students[0]?.student;
      const primaryContact = firstStudent?.contacts?.find((c) => c.isPrimary) || firstStudent?.contacts?.[0];
      const preferredPhone = primaryContact?.phone || firstStudent?.phone || "";

      return {
        id: item.id,
        description: item.description,
        responsible: item.responsible,
        dueDate: item.dueDate ? item.dueDate.toISOString() : null,
        daysDiff,
        urgency,
        category: classification.category,
        categoryLabel: classification.label,
        createdAt: item.createdAt.toISOString(),
        minuteId: item.minute.id,
        ataNumber: item.minute.ataNumber,
        year: item.minute.year,
        subject: item.minute.subject,
        students: item.minute.students.map((s) => ({
          studentId: s.studentId,
          name: s.studentNameSnapshot,
          className: s.classNameSnapshot,
        })),
        contactSuggestion: preferredPhone
          ? {
              phone: preferredPhone,
              contactName: primaryContact?.name || "Responsável",
            }
          : null,
      };
    });

    return NextResponse.json({
      schoolId: school.id,
      todayStr,
      metrics: {
        totalPending: visiblePendingActions.length,
        overdueCount,
        dueTodayCount,
        dueSoonCount,
      },
      criticalItems: criticalItems.filter((i) => i.urgency !== "NORMAL"),
      allPendingItems: criticalItems,
    });
  } catch (error: any) {
    console.error("[GET /api/atas/actions/alerts] Erro:", error);
    return NextResponse.json(
      { error: "Erro ao consultar alertas de encaminhamentos" },
      { status: 500 }
    );
  }
}
