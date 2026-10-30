import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkIsAdmin } from "@/lib/permissions";
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

  const users = await prisma.user.findMany({
    include: {
      _count: {
        select: {
          messageLogs: true,
          repliedLogs: true,
        },
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
