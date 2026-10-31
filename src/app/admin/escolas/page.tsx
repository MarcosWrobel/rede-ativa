import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getCurrentSchool } from "@/lib/currentSchool";
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

  const userRole = sessionUser?.role;
  const userEmail = (session.user.email || "").toLowerCase().trim();
  const isAdmin = userRole === "ADMIN" || userEmail === "marcos.wrobel@escola.pr.gov.br";

  if (!isAdmin) {
    redirect("/");
  }

  const currentSchool = await getCurrentSchool(sessionUser?.schoolId);

  // Fetch all registered schools with aggregate counts
  const schools = await prisma.school.findMany({
    orderBy: [{ network: "asc" }, { name: "asc" }],
    include: {
      _count: {
        select: {
          students: true,
          classes: true,
          users: true,
          userSchools: true,
        },
      },
    },
  });

  const formattedSchools = schools.map((s) => ({
    id: s.id,
    name: s.name,
    shortName: s.name.replace(/^(Colégio Estadual|Escola Municipal|C\.E\.|E\.M\.)\s+/i, ""),
    inep: s.inepCode,
    network: (s.network || "ESTADUAL") as "ESTADUAL" | "MUNICIPAL" | "PRIVADA",
    municipality: s.city,
    state: s.state,
    phone: s.phone,
    email: s.email,
    logoUrl: s.logoUrl,
    hasSyncToken: Boolean(s.syncTokenHash),
    studentsCount: s._count.students,
    classesCount: s._count.classes,
    staffCount: s._count.userSchools || s._count.users,
    createdAt: s.createdAt.toISOString(),
  }));

  return (
    <AdminEscolasClient
      schools={formattedSchools}
      activeSchoolId={currentSchool?.id || null}
    />
  );
}
