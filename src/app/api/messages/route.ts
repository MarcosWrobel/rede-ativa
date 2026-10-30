import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get("pageSize") || "30", 10) || 30));
    const search = (searchParams.get("search") || "").trim();
    const segment = searchParams.get("segment") || "TODOS";
    const classGroupId = (searchParams.get("classGroupId") || "").trim();
    const pedagoga = (searchParams.get("pedagoga") || "").trim();
    const replied = searchParams.get("replied") || "TODOS";
    const deliveryStatus = (searchParams.get("deliveryStatus") || "TODOS").trim();
    const replyCategory = (searchParams.get("replyCategory") || "TODOS").trim();
    const dateFrom = (searchParams.get("dateFrom") || "").trim();
    const dateTo = (searchParams.get("dateTo") || "").trim();

    const andFilters: any[] = [];

    if (search) {
      andFilters.push({
        OR: [
          { student: { name: { contains: search, mode: "insensitive" } } },
          { student: { cgm: { contains: search } } },
          { reasonTitle: { contains: search, mode: "insensitive" } },
          { phoneUsed: { contains: search.replace(/\D/g, "") || search } },
          { replyNotes: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    if (classGroupId) {
      andFilters.push({ student: { classGroupId } });
    } else if (segment && segment !== "TODOS") {
      andFilters.push({ student: { classGroup: { segment } } });
    }

    if (pedagoga) {
      andFilters.push({ sentByName: pedagoga });
    }

    if (replied === "SIM") {
      andFilters.push({ guardianReplied: true });
    } else if (replied === "NAO") {
      andFilters.push({ guardianReplied: false });
    }

    if (deliveryStatus && deliveryStatus !== "TODOS") {
      andFilters.push({ deliveryStatus });
    }

    if (replyCategory && replyCategory !== "TODOS") {
      andFilters.push({ replyCategory });
    }

    if (dateFrom || dateTo) {
      const sentAtRange: Record<string, Date> = {};
      if (dateFrom) {
        const start = new Date(`${dateFrom}T00:00:00.000-03:00`);
        if (!isNaN(start.getTime())) sentAtRange.gte = start;
      }
      if (dateTo) {
        const end = new Date(`${dateTo}T23:59:59.999-03:00`);
        if (!isNaN(end.getTime())) sentAtRange.lte = end;
      }
      if (Object.keys(sentAtRange).length > 0) {
        andFilters.push({ sentAt: sentAtRange });
      }
    }

    const where = andFilters.length > 0 ? { AND: andFilters } : {};
    const skip = (page - 1) * pageSize;

    const [total, logs] = await Promise.all([
      prisma.messageLog.count({ where }),
      prisma.messageLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { sentAt: "desc" },
        include: {
          student: {
            include: { classGroup: true },
          },
        },
      }),
    ]);

    return NextResponse.json({
      logs,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (error: any) {
    console.error("Erro na listagem paginada do histórico:", error);
    return NextResponse.json(
      { error: error.message || "Erro ao consultar histórico." },
      { status: 500 }
    );
  }
}
