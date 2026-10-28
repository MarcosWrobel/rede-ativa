import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import HistoricoClient from "./HistoricoClient";
import { redirect } from "next/navigation";

export default async function HistoricoPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const [logs, classGroups] = await Promise.all([
    prisma.messageLog.findMany({
      take: 200,
      orderBy: { sentAt: "desc" },
      include: {
        student: {
          include: { classGroup: true },
        },
      },
    }),
    prisma.classGroup.findMany({
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <HistoricoClient
      initialLogs={logs}
      classGroups={classGroups}
      currentUser={{
        name: session.user.name || "Pedagoga",
        email: session.user.email || "",
      }}
    />
  );
}
