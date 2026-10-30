import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkIsAdmin } from "@/lib/permissions";
import AuditoriaClient from "./AuditoriaClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AuditoriaPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  if (!checkIsAdmin(session)) {
    redirect("/busca-ativa");
  }

  const logs = await prisma.auditLog.findMany({
    take: 300,
    orderBy: { createdAt: "desc" },
  });

  return <AuditoriaClient initialLogs={logs} />;
}
