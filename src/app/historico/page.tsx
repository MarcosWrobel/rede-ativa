import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import HistoricoClient from "./HistoricoClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HistoricoPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const email = (session.user.email || "").toLowerCase().trim();
  const role = (session.user as any)?.role;
  const isAdmin =
    role === "ADMIN" ||
    email === "marcos.wrobel@escola.pr.gov.br" ||
    email.includes("marcos") ||
    (process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.toLowerCase().trim());

  const [logs, classGroups] = await Promise.all([
    prisma.messageLog.findMany({
      take: 400,
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
        role: isAdmin ? "ADMIN" : "PEDAGOGA",
      }}
    />
  );
}
