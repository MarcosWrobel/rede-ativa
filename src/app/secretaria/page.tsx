import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkIsAdmin, checkIsSecretariat, checkIsSuperAdmin } from "@/lib/roles";
import SecretariaClient from "./SecretariaClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Painel da Secretaria Municipal de Educação | Gestão da Rede SEMEC",
};

export default async function SecretariaPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const isSuper = checkIsSuperAdmin(session);
  const isSec = checkIsSecretariat(session);

  if (!isSuper && !isSec && !checkIsAdmin(session)) {
    redirect("/");
  }

  const userNetworks = ((session.user as any)?.networks as any[]) || [];
  const defaultCity = userNetworks[0]?.city || "Tibagi";

  const municipalSchools = await prisma.school.findMany({
    where: {
      active: true,
      network: "MUNICIPAL",
      ...(defaultCity ? { city: { equals: defaultCity, mode: "insensitive" } } : {}),
    },
    include: {
      _count: {
        select: {
          students: true,
          classGroups: true,
          userSchools: true,
          pedagogicalMinutes: true,
        },
      },
      students: {
        where: { active: true },
        select: {
          id: true,
          lowAttendanceRecord: {
            select: { attendancePercent: true },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  let totalStudents = 0;
  let totalClasses = 0;
  let criticalCount = 0;
  let totalPercentSum = 0;
  let studentsWithRecord = 0;

  const formattedSchools = municipalSchools.map((s) => {
    let schoolCritical = 0;
    let schoolSum = 0;
    let schoolRecorded = 0;

    s.students.forEach((st) => {
      if (st.lowAttendanceRecord) {
        const pct = st.lowAttendanceRecord.attendancePercent;
        schoolSum += pct;
        schoolRecorded++;
        if (pct < 75) {
          schoolCritical++;
        }
      }
    });

    totalStudents += s._count.students;
    totalClasses += s._count.classGroups;
    criticalCount += schoolCritical;
    totalPercentSum += schoolSum;
    studentsWithRecord += schoolRecorded;

    const avgAttendance =
      schoolRecorded > 0 ? Number((schoolSum / schoolRecorded).toFixed(1)) : 100;

    return {
      id: s.id,
      name: s.name,
      shortName: s.name.replace(/^(Escola Municipal|E\.M\.)\s+/i, ""),
      inepCode: s.inepCode,
      city: s.city,
      state: s.state,
      phone: s.phone,
      email: s.email,
      logoUrl: s.logoUrl,
      studentsCount: s._count.students,
      classesCount: s._count.classGroups,
      staffCount: s._count.userSchools,
      minutesCount: s._count.pedagogicalMinutes,
      criticalCount: schoolCritical,
      averageAttendance: avgAttendance,
    };
  });

  const networkAvg =
    studentsWithRecord > 0 ? Number((totalPercentSum / studentsWithRecord).toFixed(1)) : 100;

  const schoolIds = municipalSchools.map((s) => s.id);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const monthlyMessages = await prisma.messageLog.count({
    where: {
      student: { schoolId: { in: schoolIds } },
      sentAt: { gte: monthStart },
    },
  });

  return (
    <SecretariaClient
      city={defaultCity}
      metrics={{
        totalSchools: municipalSchools.length,
        totalStudents,
        totalClasses,
        criticalStudentsCount: criticalCount,
        networkAverageAttendance: networkAvg,
        messagesSentThisMonth: monthlyMessages,
      }}
      initialSchools={formattedSchools}
      isSuperAdmin={isSuper}
      currentUser={{
        name: session.user.name || "Gestor SEMEC",
        email: session.user.email || "",
      }}
    />
  );
}
