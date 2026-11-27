import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isSnapshotSuperAdmin, resolveServerUserAuthSnapshot } from "@/lib/serverAuthContext";
import { aggregateAdminMetrics } from "@/lib/adminMetrics";
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

  const snapshot = await resolveServerUserAuthSnapshot(session);
  if (!snapshot || snapshot.active === false) {
    redirect("/login?error=AccountInactive");
  }

  const isSuper = isSnapshotSuperAdmin(snapshot);
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
    const aggregated = await aggregateAdminMetrics();
    totalNetworks = aggregated.metrics.totalNetworks;
    totalSchools = aggregated.metrics.totalSchools;
    totalStudents = aggregated.metrics.totalStudents;
    totalMessages = aggregated.metrics.totalMessages;
    networks = aggregated.networks;
    schools = aggregated.schools;
    auditLogs = aggregated.auditLogs;
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
