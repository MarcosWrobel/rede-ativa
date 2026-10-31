import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkIsAdmin, checkIsSuperAdmin, isBootstrapAdminEmail } from "@/lib/roles";
import { getCurrentSchool } from "@/lib/currentSchool";
import EquipeClient from "./EquipeClient";

export const dynamic = "force-dynamic";

export default async function EquipePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  if (!checkIsAdmin(session)) {
    redirect("/busca-ativa");
  }

  const currentSchool = await getCurrentSchool((session.user as any)?.schoolId);
  const isSuper = checkIsSuperAdmin(session);

  const whereClause: any = isSuper
    ? {}
    : {
        OR: [
          { schoolId: currentSchool.id },
          { schools: { some: { schoolId: currentSchool.id } } },
        ],
      };

  const users = await prisma.user.findMany({
    where: whereClause,
    include: {
      _count: {
        select: {
          messageLogs: true,
          repliedLogs: true,
        },
      },
      schools: {
        where: { schoolId: currentSchool.id },
        select: { role: true, active: true },
      },
    },
    orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }],
  });

  return (
    <EquipeClient
      initialUsers={users}
      currentAdminEmail={(session.user.email || "").toLowerCase().trim()}
    />
  );
}
