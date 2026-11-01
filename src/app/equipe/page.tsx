import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkIsAdmin, checkIsSuperAdmin } from "@/lib/roles";
import { getCurrentSchool } from "@/lib/currentSchool";
import EquipeClient from "./EquipeClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Equipe & Controle de Acessos | Gestão Escolar",
};

export default async function EquipePage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  if (!checkIsAdmin(session)) {
    redirect("/busca-ativa");
  }

  const currentSchool = await getCurrentSchool((session.user as any)?.schoolId);
  const isSuper = checkIsSuperAdmin(session);

  let viewAll = false;
  try {
    const sp = await searchParams;
    if (sp?.view === "all" && isSuper) {
      viewAll = true;
    }
  } catch {
    viewAll = false;
  }

  // Por padrão, exibe estritamente a equipe vinculada à escola ativa selecionada.
  // Somente se SuperAdmin optar por viewAll é exibido o catálogo global de todas as escolas.
  const whereClause: any = viewAll
    ? {}
    : {
        OR: [
          { schoolId: currentSchool.id },
          { schools: { some: { schoolId: currentSchool.id, active: true } } },
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
        where: viewAll ? undefined : { schoolId: currentSchool.id },
        select: { role: true, active: true, schoolId: true },
      },
    },
    orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }],
  });

  // Mapeia o role efetivo na escola ativa para cada usuário
  const formattedUsers = users.map((u) => {
    const schoolLink = u.schools.find((s) => s.schoolId === currentSchool.id);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: schoolLink?.role || u.role,
      active: schoolLink ? schoolLink.active : u.active,
      createdAt: u.createdAt,
      _count: u._count,
    };
  });

  return (
    <EquipeClient
      initialUsers={formattedUsers}
      currentAdminEmail={(session.user.email || "").toLowerCase().trim()}
      currentSchool={{
        id: currentSchool.id,
        name: currentSchool.name,
        inepCode: currentSchool.inepCode,
        city: currentSchool.city,
        network: currentSchool.network,
      }}
      isSuperAdmin={isSuper}
      viewAll={viewAll}
    />
  );
}
