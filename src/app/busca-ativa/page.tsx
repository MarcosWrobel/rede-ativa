import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { safeQueryList } from "@/lib/safePhase3Queries";
import { getCurrentSchool } from "@/lib/currentSchool";
import BuscaAtivaClient from "./BuscaAtivaClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function BuscaAtivaPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string; phone?: string; mode?: string; turmaId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const currentSchool = await getCurrentSchool((session.user as any)?.schoolId);
  const schoolId = currentSchool.id;

  let sp: { studentId?: string; phone?: string; mode?: string; turmaId?: string } = {};
  try {
    if (searchParams) {
      sp = (await searchParams) || {};
    }
  } catch (e) {
    console.warn("[BuscaAtivaPage] Erro ao ler searchParams:", e);
    sp = {};
  }

  const recentCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

  let classGroups: any[] = [];
  let templates: any[] = [];
  let rawStudents: any[] = [];
  let recentLogs: any[] = [];
  let recentJustifications: any[] = [];
  let allContacts: any[] = [];

  try {
    const results = await Promise.all([
      prisma.classGroup.findMany({
        where: { schoolId },
        select: { id: true, name: true, segment: true, shift: true },
        orderBy: { name: "asc" },
      }),
      prisma.messageTemplate.findMany({
        where: { active: true, schoolId },
        select: {
          id: true,
          title: true,
          segment: true,
          prefixText: true,
          suffixText: true,
          isAbsenceRelated: true,
        },
        orderBy: { title: "asc" },
      }),
      prisma.student.findMany({
        where: { schoolId, active: true },
        select: {
          id: true,
          cgm: true,
          name: true,
          guardianName: true,
          phone: true,
          isExchangeStudent: true,
          isSpecialNeeds: true,
          age: true,
          classGroupId: true,
          classGroup: {
            select: { id: true, name: true, segment: true, shift: true },
          },
          lowAttendanceRecord: {
            select: { attendancePercent: true, actionsTaken: true, enrollmentDetail: true },
          },
          messageLogs: {
            orderBy: { sentAt: "desc" },
            take: 1,
            select: { sentAt: true, reasonTitle: true, sentByName: true },
          },
        },
        orderBy: { name: "asc" },
      }),
      prisma.messageLog.findMany({
        where: { student: { schoolId } },
        take: 150,
        orderBy: { sentAt: "desc" },
        select: {
          id: true,
          studentId: true,
          reasonTitle: true,
          sentByName: true,
          sentAt: true,
        },
      }),
      safeQueryList(() =>
        prisma.absenceJustification.findMany({
          where: { student: { schoolId }, endDate: { gte: recentCutoff } },
          orderBy: { endDate: "desc" },
        })
      ),
      safeQueryList(() =>
        prisma.studentContact.findMany({
          where: { student: { schoolId } },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        })
      ),
    ]);

    classGroups = results[0] || [];
    templates = results[1] || [];
    rawStudents = results[2] || [];
    recentLogs = results[3] || [];
    recentJustifications = results[4] || [];
    allContacts = results[5] || [];
  } catch (err) {
    console.error("[BuscaAtivaPage] Erro ao carregar dados do banco:", err);
  }

  const justMap = new Map<string, any[]>();
  recentJustifications.forEach((j: any) => {
    if (!j?.studentId) return;
    const arr = justMap.get(j.studentId) || [];
    arr.push(j);
    justMap.set(j.studentId, arr);
  });

  const contactsMap = new Map<string, any[]>();
  allContacts.forEach((c: any) => {
    if (!c?.studentId) return;
    const arr = contactsMap.get(c.studentId) || [];
    arr.push(c);
    contactsMap.set(c.studentId, arr);
  });

  const logsMap = new Map<string, any[]>();
  recentLogs.forEach((l: any) => {
    if (!l?.studentId) return;
    const list = logsMap.get(l.studentId) || [];
    if (list.length < 3) {
      list.push(l);
      logsMap.set(l.studentId, list);
    }
  });

  const initialStudents = rawStudents.map((s) => ({
    ...s,
    messageLogs: logsMap.get(s.id) || [],
    justifications: justMap.get(s.id) || [],
    contacts: contactsMap.get(s.id) || [],
  }));

  return (
    <BuscaAtivaClient
      classGroups={classGroups}
      templates={templates}
      initialStudents={initialStudents}
      initialSelectedStudentId={sp?.studentId || ""}
      initialCustomPhone={sp?.phone || ""}
      initialMode={sp?.mode === "fila" ? "fila" : "individual"}
      initialTurmaId={sp?.turmaId || ""}
      currentUser={{
        name: session.user.name || "Pedagoga",
        email: session.user.email || "",
      }}
    />
  );
}
