import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { safeQueryList } from "@/lib/safePhase3Queries";
import FaltasClient from "./FaltasClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function FaltasPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // Contabiliza tanto comunicados vinculados a modelos marcados como "Relacionado a Faltas" (isAbsenceRelated)
  // quanto registros históricos migrados sem vínculo de modelo que contenham termos de ausência no motivo.
  const absenceKeywords = [
    "FALTOU",
    "FALTAS",
    "GAZEOU",
    "ATRASO",
    "ATRASOS",
    "INFREQU",
    "AUSÊNCIA",
    "AUSENCIA",
    "BUSCA ATIVA",
  ];

  const recentCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const [
    absenceLogs,
    lowAttendance,
    classGroups,
    templates,
    recentJustifications,
    allContacts,
    recentSnapshots,
  ] = await Promise.all([
    prisma.messageLog.findMany({
      where: {
        OR: [
          { template: { isAbsenceRelated: true } },
          ...absenceKeywords.map((kw) => ({
            templateId: null,
            reasonTitle: { contains: kw, mode: "insensitive" as const },
          })),
          ...absenceKeywords.slice(0, 5).map((kw) => ({
            reasonTitle: { contains: kw, mode: "insensitive" as const },
          })),
        ],
      },
      select: {
        studentId: true,
        sentAt: true,
        student: {
          select: {
            id: true,
            cgm: true,
            name: true,
            phone: true,
            guardianName: true,
            isExchangeStudent: true,
            isSpecialNeeds: true,
            age: true,
            classGroupId: true,
            classGroup: {
              select: { id: true, name: true, segment: true, shift: true },
            },
          },
        },
      },
    }),
    prisma.lowAttendanceRecord.findMany({
      select: {
        id: true,
        attendancePercent: true,
        enrollmentDetail: true,
        actionsTaken: true,
        serpProtocol: true,
        serpStatus: true,
        serpOpenedAt: true,
        serpDetails: true,
        student: {
          select: {
            id: true,
            cgm: true,
            name: true,
            phone: true,
            guardianName: true,
            isExchangeStudent: true,
            isSpecialNeeds: true,
            age: true,
            classGroupId: true,
            classGroup: {
              select: { id: true, name: true, segment: true, shift: true },
            },
          },
        },
      },
      orderBy: { attendancePercent: "asc" },
    }),
    prisma.classGroup.findMany({
      select: { id: true, name: true, segment: true, shift: true },
      orderBy: { name: "asc" },
    }),
    prisma.messageTemplate.findMany({
      where: { active: true },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        segment: true,
        prefixText: true,
        suffixText: true,
        isAbsenceRelated: true,
      },
    }),
    safeQueryList(() =>
      prisma.absenceJustification.findMany({
        where: { endDate: { gte: recentCutoff } },
        orderBy: { endDate: "desc" },
      })
    ),
    safeQueryList(() =>
      prisma.studentContact.findMany({
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      })
    ),
    safeQueryList(() =>
      prisma.attendanceSnapshot.findMany({
        orderBy: { recordedAt: "desc" },
      })
    ),
  ]);

  const justMap = new Map<string, any[]>();
  recentJustifications.forEach((j: any) => {
    const arr = justMap.get(j.studentId) || [];
    arr.push(j);
    justMap.set(j.studentId, arr);
  });

  const contactsMap = new Map<string, any[]>();
  allContacts.forEach((c: any) => {
    const arr = contactsMap.get(c.studentId) || [];
    arr.push(c);
    contactsMap.set(c.studentId, arr);
  });

  const snapshotsMap = new Map<string, any[]>();
  recentSnapshots.forEach((sn: any) => {
    const arr = snapshotsMap.get(sn.studentId) || [];
    if (arr.length < 3) {
      arr.push(sn);
      snapshotsMap.set(sn.studentId, arr);
    }
  });

  const enrichStudent = (st: any) => ({
    ...st,
    justifications: justMap.get(st.id) || [],
    contacts: contactsMap.get(st.id) || [],
    snapshots: snapshotsMap.get(st.id) || [],
  });

  const studentCountMap: Record<string, { student: any; count: number; lastDate: Date }> = {};

  absenceLogs.forEach((log) => {
    if (!log.student || !log.student.classGroup) return;
    const sId = log.studentId;
    if (!studentCountMap[sId]) {
      studentCountMap[sId] = {
        student: enrichStudent(log.student),
        count: 0,
        lastDate: log.sentAt,
      };
    }
    studentCountMap[sId].count += 1;
    if (new Date(log.sentAt) > new Date(studentCountMap[sId].lastDate)) {
      studentCountMap[sId].lastDate = log.sentAt;
    }
  });

  const rankedAbsences = Object.values(studentCountMap).sort((a, b) => b.count - a.count);
  const validLowAttendance = lowAttendance
    .filter((rec) => rec.student && rec.student.classGroup)
    .map((rec) => ({
      ...rec,
      student: enrichStudent(rec.student),
    }));

  return (
    <FaltasClient
      rankedAbsences={rankedAbsences}
      lowAttendance={validLowAttendance}
      classGroups={classGroups}
      templates={templates}
      currentUser={{
        name: session.user.name || "Equipe Pedagógica",
        email: session.user.email || "",
      }}
    />
  );
}
