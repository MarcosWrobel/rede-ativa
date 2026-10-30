import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkIsAdmin } from "@/lib/permissions";
import HistoricoClient from "./HistoricoClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const INITIAL_PAGE_SIZE = 30;

export default async function HistoricoPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const isAdmin = checkIsAdmin(session);

  const [logs, totalCount, classGroups, pedagogaRows] = await Promise.all([
    prisma.messageLog.findMany({
      take: INITIAL_PAGE_SIZE,
      orderBy: { sentAt: "desc" },
      include: {
        student: {
          include: { classGroup: true },
        },
      },
    }),
    prisma.messageLog.count(),
    prisma.classGroup.findMany({
      orderBy: { name: "asc" },
    }),
    prisma.messageLog.findMany({
      distinct: ["sentByName"],
      select: { sentByName: true },
      orderBy: { sentByName: "asc" },
    }),
  ]);

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
        role: isAdmin ? "ADMIN" : "PEDAGOGA",
      }}
    />
  );
}
