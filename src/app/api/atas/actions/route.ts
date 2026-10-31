import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status") || "ALL"; // ALL | PENDING | OVERDUE | COMPLETED
    const responsible = searchParams.get("responsible") || "ALL"; // ALL | FAMILIA | ESTUDANTE | ESCOLA | REDE_PROTECAO
    const search = searchParams.get("q")?.trim();
    const classGroupId = searchParams.get("classGroupId");
    const limit = Math.min(Number(searchParams.get("limit") || 150), 300);

    const school = await getCurrentSchool(authCheck.session?.user?.schoolId);

    const now = new Date();
    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
    const startOfTodayBrasilia = new Date(`${todayStr}T00:00:00.000-03:00`);

    const in7Days = new Date(startOfTodayBrasilia);
    in7Days.setDate(in7Days.getDate() + 7);

    const where: any = {
      minute: {
        schoolId: school.id,
        status: { in: ["FINALIZED", "DRAFT"] }, // Ações de atas ativas
      },
    };

    if (responsible && responsible !== "ALL") {
      where.responsible = responsible;
    }

    if (statusParam === "PENDING") {
      where.status = "PENDING";
    } else if (statusParam === "COMPLETED") {
      where.status = "COMPLETED";
    } else if (statusParam === "OVERDUE") {
      where.status = "PENDING";
      where.dueDate = { lt: startOfTodayBrasilia };
    }

    if (classGroupId && classGroupId !== "ALL") {
      where.minute.students = {
        some: {
          student: { classGroupId },
        },
      };
    }

    if (search) {
      where.OR = [
        { description: { contains: search, mode: "insensitive" } },
        { completionNotes: { contains: search, mode: "insensitive" } },
        { minute: { subject: { contains: search, mode: "insensitive" } } },
        {
          minute: {
            students: {
              some: {
                studentNameSnapshot: { contains: search, mode: "insensitive" },
              },
            },
          },
        },
      ];
    }

    const [actionItems, allSchoolActions, classes] = await Promise.all([
      prisma.pedagogicalActionItem.findMany({
        where,
        take: limit,
        orderBy: [
          { status: "asc" }, // PENDING primeiro
          { dueDate: "asc" }, // Mais urgentes primeiro
          { createdAt: "desc" },
        ],
        include: {
          minute: {
            select: {
              id: true,
              ataNumber: true,
              year: true,
              subject: true,
              attendedAt: true,
              finalizedAt: true,
              status: true,
              isConfidential: true,
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
      }),
      // Métricas gerais de todos os combinados da escola
      prisma.pedagogicalActionItem.findMany({
        where: {
          minute: { schoolId: school.id, status: { in: ["FINALIZED", "DRAFT"] } },
        },
        select: {
          id: true,
          status: true,
          dueDate: true,
          responsible: true,
        },
      }),
      prisma.classGroup.findMany({
        select: { id: true, name: true, shift: true },
        orderBy: { name: "asc" },
      }),
    ]);

    // Calcula métricas analíticas
    let total = allSchoolActions.length;
    let completed = 0;
    let pending = 0;
    let overdue = 0;
    let dueSoon = 0; // Próximos 7 dias

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

    return NextResponse.json({
      success: true,
      actionItems,
      metrics: {
        total,
        completed,
        pending,
        overdue,
        dueSoon,
      },
      classes,
    });
  } catch (error: any) {
    console.error("[GET /api/atas/actions] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao consultar combinados" }, { status: 500 });
  }
}
