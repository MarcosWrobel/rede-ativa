import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getCurrentSchool } from "@/lib/currentSchool";
import { checkIsAdmin } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import AdminEscolasClient from "./AdminEscolasClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Gestão de Escolas & Redes de Ensino | Painel Administrativo",
};

export default async function AdminEscolasPage() {
  const session = await auth();
  const sessionUser = session?.user as any;

  if (!session?.user) {
    redirect("/login");
  }

  if (!checkIsAdmin(session)) {
    redirect("/");
  }

  const currentSchool = await getCurrentSchool(sessionUser?.schoolId);

  // Fetch all registered schools with aggregate counts and recent activity
  const schools = await prisma.school.findMany({
    orderBy: [{ network: "asc" }, { name: "asc" }],
    include: {
      _count: {
        select: {
          students: true,
          classGroups: true,
          users: true,
          userSchools: true,
        },
      },
      userSchools: {
        where: { active: true },
        include: {
          user: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
        take: 6,
      },
      students: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { updatedAt: true },
      },
    },
  });

  const formattedSchools = schools.map((s) => {
    let settings: any = {};
    try {
      if (s.settingsJson) settings = JSON.parse(s.settingsJson);
    } catch {}

    const lastSyncAt = s.students[0]?.updatedAt ? s.students[0].updatedAt.toISOString() : null;

    return {
      id: s.id,
      name: s.name,
      shortName: s.name.replace(/^(Colégio Estadual|Escola Municipal|C\.E\.|E\.M\.)\s+/i, ""),
      inep: s.inepCode,
      nre: s.nre || null,
      network: (s.network || "ESTADUAL") as "ESTADUAL" | "MUNICIPAL" | "PRIVADA",
      municipality: s.city,
      state: s.state,
      phone: s.phone,
      email: s.email,
      logoUrl: s.logoUrl,
      settings,
      hasSyncToken: Boolean(s.syncTokenHash),
      lastSyncAt,
      studentsCount: s._count.students,
      classesCount: s._count.classGroups,
      staffCount: s._count.userSchools || s._count.users,
      staff: s.userSchools.map((us) => ({
        id: us.user.id,
        name: us.user.name,
        email: us.user.email,
        role: us.role || us.user.role,
      })),
      createdAt: s.createdAt.toISOString(),
    };
  });

  return (
    <AdminEscolasClient
      schools={formattedSchools}
      activeSchoolId={currentSchool?.id || null}
    />
  );
}
