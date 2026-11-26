import { prisma } from "@/lib/prisma";
import { resolveAuthorizedPageContext } from "@/lib/pageAuth";
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
  const ctx = await resolveAuthorizedPageContext({ requireManager: true });
  const session = ctx.session;
  const currentSchool = ctx.school;
  const isSuper = ctx.isSuperAdmin;

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
        schools: { some: { schoolId: currentSchool.id } },
      };

  const users = await prisma.user.findMany({
    where: whereClause,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      schoolId: true,
      createdAt: true,
      updatedAt: true,
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

  // Mapeia o role efetivo na escola ativa para cada usuário (ou estado global no catálogo viewAll)
  const formattedUsers = users.map((u) => {
    const schoolLink = viewAll ? undefined : u.schools.find((s) => s.schoolId === currentSchool.id);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: viewAll ? u.role : (schoolLink?.role || u.role),
      active: viewAll ? Boolean(u.active) : (schoolLink ? Boolean(schoolLink.active) : Boolean(u.active)),
      globalActive: Boolean(u.active),
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
