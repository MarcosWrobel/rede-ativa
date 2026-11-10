import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkIsSuperAdmin } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { resolveSchoolEdition } from "@/lib/platformEditions";
import { resolveSchoolLogoProxyUrl } from "@/lib/schoolLogo";
import AdminClient from "./AdminClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Super Admin SaaS | Painel Global da Plataforma",
};

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const isSuper = checkIsSuperAdmin(session);
  if (!isSuper) {
    redirect("/");
  }

  let totalNetworks = 0;
  let totalSchools = 0;
  let totalStudents = 0;
  let totalMessages = 0;
  let networks: any[] = [];
  let schools: any[] = [];
  let auditLogs: any[] = [];

  try {
    const [
      networksCount,
      schoolsCount,
      studentsCount,
      messagesCount,
      networksList,
      schoolsList,
      recentAudit,
    ] = await Promise.all([
      prisma.educationNetwork.count({ where: { active: true } }),
      prisma.school.count({ where: { active: true } }),
      prisma.student.count({ where: { active: true } }),
      prisma.messageLog.count(),
      prisma.educationNetwork.findMany({
        where: { active: true },
        include: {
          _count: { select: { schools: true, managers: true } },
          schools: { select: { inepCode: true, settingsJson: true }, take: 1 },
        },
        orderBy: { name: "asc" },
      }),
      prisma.school.findMany({
        where: { active: true },
        select: {
          id: true,
          name: true,
          inepCode: true,
          city: true,
          network: true,
          settingsJson: true,
          updatedAt: true,
          educationNetwork: { select: { name: true } },
          _count: { select: { students: { where: { active: true } }, classGroups: true } },
        },
        orderBy: [{ network: "asc" }, { name: "asc" }],
      }),
      prisma.auditLog.findMany({
        take: 8,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          action: true,
          userName: true,
          createdAt: true,
          details: true,
        },
      }),
    ]);

    totalNetworks = networksCount;
    totalSchools = schoolsCount;
    totalStudents = studentsCount;
    totalMessages = messagesCount;

    networks = networksList.map((n) => ({
      id: n.id,
      name: n.name,
      shortName: n.shortName,
      city: n.city,
      state: n.state,
      type: n.type,
      schoolsCount: n._count.schools,
      managersCount: n._count.managers,
      edition: n.schools[0]
        ? resolveSchoolEdition(n.schools[0])
        : "INSTITUCIONAL_ESSENCIAL",
    }));

    schools = schoolsList.map((s) => ({
      id: s.id,
      name: s.name,
      inepCode: s.inepCode,
      city: s.city,
      network: s.network,
      networkName: s.educationNetwork?.name || null,
      studentsCount: s._count.students,
      classesCount: s._count.classGroups,
      logoUrl: resolveSchoolLogoProxyUrl({
        id: s.id,
        logoUrl: (s as { logoUrl?: string | null }).logoUrl,
        updatedAt: s.updatedAt,
      }),
      edition: resolveSchoolEdition(s),
    }));

    auditLogs = recentAudit.map((a) => ({
      id: a.id,
      action: a.action,
      userName: a.userName,
      createdAt: a.createdAt.toISOString(),
      details: a.details,
    }));
  } catch (err) {
    console.error("[AdminPage] Erro ao carregar métricas globais:", err);
  }

  return (
    <AdminClient
      metrics={{
        totalNetworks,
        totalSchools,
        totalStudents,
        totalMessages,
      }}
      networks={networks}
      schools={schools}
      auditLogs={auditLogs}
      currentUser={{
        name: session.user.name || "Super Admin",
        email: session.user.email || "",
      }}
    />
  );
}
