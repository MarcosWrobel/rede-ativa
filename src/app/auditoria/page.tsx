import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AuditoriaClient from "./AuditoriaClient";
import { redirect } from "next/navigation";

export default async function AuditoriaPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const logs = await prisma.auditLog.findMany({
    take: 200,
    orderBy: { createdAt: "desc" },
  });

  return <AuditoriaClient initialLogs={logs} />;
}
