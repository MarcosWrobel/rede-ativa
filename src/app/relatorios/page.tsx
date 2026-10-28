import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import RelatoriosClient from "./RelatoriosClient";
import { redirect } from "next/navigation";

export default async function RelatoriosPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const logs = await prisma.messageLog.findMany({
    include: {
      student: {
        include: { classGroup: true },
      },
    },
  });

  return <RelatoriosClient allLogs={logs} />;
}
