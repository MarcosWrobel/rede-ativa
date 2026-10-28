import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import RelatoriosClient from "./RelatoriosClient";
import { redirect } from "next/navigation";

export const revalidate = 60; // Cache for 60 seconds

export default async function RelatoriosPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // Optimized lightweight fetch for aggregations
  const logs = await prisma.messageLog.findMany({
    select: {
      id: true,
      reasonTitle: true,
      sentByName: true,
      guardianReplied: true,
      student: {
        select: {
          classGroup: {
            select: { segment: true },
          },
        },
      },
    },
  });

  return <RelatoriosClient allLogs={logs} />;
}
