import { prisma } from "./prisma";

export interface ReportsFilterParams {
  segment?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface ReportsSummary {
  total: number;
  replied: number;
  pending: number;
  repliedPercent: string;
  pendingPercent: string;
  reasonStats: Array<{ reason: string; count: number; percent: string }>;
  pedagogaStats: Array<{ pedagoga: string; count: number; percent: string }>;
}

export async function getReportsSummary(params: ReportsFilterParams = {}): Promise<ReportsSummary> {
  const { segment = "TODOS", dateFrom, dateTo } = params;
  const andFilters: any[] = [];

  if (segment && segment !== "TODOS") {
    andFilters.push({
      student: {
        classGroup: { segment },
      },
    });
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

  const [total, replied, byReason, byPedagoga] = await Promise.all([
    prisma.messageLog.count({ where }),
    prisma.messageLog.count({ where: { ...where, guardianReplied: true } }),
    prisma.messageLog.groupBy({
      by: ["reasonTitle"],
      where,
      _count: { _all: true },
      orderBy: { _count: { reasonTitle: "desc" } },
    }),
    prisma.messageLog.groupBy({
      by: ["sentByName"],
      where,
      _count: { _all: true },
      orderBy: { _count: { sentByName: "desc" } },
    }),
  ]);

  const denom = total || 1;
  const pending = Math.max(0, total - replied);

  const reasonStats = byReason.map((r) => ({
    reason: r.reasonTitle || "Outros",
    count: r._count._all,
    percent: ((r._count._all / denom) * 100).toFixed(1),
  }));

  const pedagogaStats = byPedagoga.map((p) => ({
    pedagoga: p.sentByName || "Equipe",
    count: p._count._all,
    percent: ((p._count._all / denom) * 100).toFixed(1),
  }));

  return {
    total,
    replied,
    pending,
    repliedPercent: total > 0 ? ((replied / denom) * 100).toFixed(1) : "0.0",
    pendingPercent: total > 0 ? ((pending / denom) * 100).toFixed(1) : "0.0",
    reasonStats,
    pedagogaStats,
  };
}
