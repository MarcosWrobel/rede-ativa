import { prisma } from "./prisma";
import { REPLY_CATEGORY_LABELS, type ReplyCategory } from "./whatsappProvider";

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
  categoryStats: Array<{ category: string; label: string; count: number; percent: string }>;
  deliveryStats: {
    confirmedCount: number;
    linkOpenedCount: number;
    failedNoWhatsappCount: number;
    failedPercent: string;
  };
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

  const [total, replied, byReason, byPedagoga, byCategory, byDelivery] = await Promise.all([
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
    prisma.messageLog
      .groupBy({
        by: ["replyCategory"],
        where: { ...where, guardianReplied: true, replyCategory: { not: null } },
        _count: { _all: true },
      })
      .catch(() => [] as Array<{ replyCategory: string | null; _count: { _all: number } }>),
    prisma.messageLog
      .groupBy({
        by: ["deliveryStatus"],
        where,
        _count: { _all: true },
      })
      .catch(() => [] as Array<{ deliveryStatus: string; _count: { _all: number } }>),
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

  let rawCategorizedSum = 0;
  const normalizedCategoryRows: Array<{ replyCategory: string | null; count: number }> = [];
  for (const row of byCategory) {
    rawCategorizedSum += row._count._all;
    normalizedCategoryRows.push({
      replyCategory: row.replyCategory,
      count: row._count._all,
    });
  }
  const totalCategorized = rawCategorizedSum || 1;

  const categoryStats = normalizedCategoryRows
    .filter((c) => Boolean(c.replyCategory))
    .sort((a, b) => b.count - a.count)
    .map((c) => {
      const catKey = c.replyCategory as ReplyCategory;
      return {
        category: catKey,
        label: REPLY_CATEGORY_LABELS[catKey] || catKey,
        count: c.count,
        percent: ((c.count / totalCategorized) * 100).toFixed(1),
      };
    });

  let confirmedCount = 0;
  let linkOpenedCount = 0;
  let failedNoWhatsappCount = 0;

  for (const d of byDelivery) {
    if (d.deliveryStatus === "FAILED_NO_WHATSAPP") {
      failedNoWhatsappCount += d._count._all;
    } else if (d.deliveryStatus === "LINK_OPENED") {
      linkOpenedCount += d._count._all;
    } else {
      confirmedCount += d._count._all;
    }
  }

  return {
    total,
    replied,
    pending,
    repliedPercent: total > 0 ? ((replied / denom) * 100).toFixed(1) : "0.0",
    pendingPercent: total > 0 ? ((pending / denom) * 100).toFixed(1) : "0.0",
    reasonStats,
    pedagogaStats,
    categoryStats,
    deliveryStats: {
      confirmedCount,
      linkOpenedCount,
      failedNoWhatsappCount,
      failedPercent: total > 0 ? ((failedNoWhatsappCount / denom) * 100).toFixed(1) : "0.0",
    },
  };
}
