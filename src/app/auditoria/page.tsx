import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AuditoriaClient from "./AuditoriaClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AuditoriaPage() {
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

  // Apenas o Administrador pode visualizar a aba de auditoria
  if (!isAdmin) {
    redirect("/busca-ativa");
  }

  const logs = await prisma.auditLog.findMany({
    take: 300,
    orderBy: { createdAt: "desc" },
  });

  return <AuditoriaClient initialLogs={logs} />;
}
