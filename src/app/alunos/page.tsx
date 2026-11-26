import { prisma } from "@/lib/prisma";
import { safeQueryList } from "@/lib/safePhase3Queries";
import { resolveAuthorizedPageContext } from "@/lib/pageAuth";
import AlunosClient from "./AlunosClient";

export const dynamic = "force-dynamic";

export default async function AlunosPage() {
  const ctx = await resolveAuthorizedPageContext();
  const currentSchool = ctx.school;
  const schoolId = currentSchool.id;

  const now = new Date();
  const recentCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  let students: any[] = [];
  let classGroups: any[] = [];
  let recentJustifications: any[] = [];
  let allContacts: any[] = [];

  try {
    const results = await Promise.all([
      prisma.student.findMany({
        where: { schoolId, active: true },
        include: {
          classGroup: true,
          _count: { select: { messageLogs: true } },
        },
        orderBy: [{ classGroup: { name: "asc" } }, { name: "asc" }],
      }),
      prisma.classGroup.findMany({
        where: { schoolId },
        orderBy: { name: "asc" },
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
          select: { id: true, studentId: true, whatsappValid: true },
        })
      ),
    ]);
    students = results[0] || [];
    classGroups = results[1] || [];
    recentJustifications = results[2] || [];
    allContacts = results[3] || [];
  } catch (err) {
    console.error("[AlunosPage] Erro ao buscar registros:", err);
  }

  const justMap = new Map<string, any[]>();
  recentJustifications.forEach((j: any) => {
    if (!j?.studentId) return;
    const arr = justMap.get(j.studentId) || [];
    arr.push(j);
    justMap.set(j.studentId, arr);
  });

  const contactsCountMap = new Map<string, number>();
  allContacts.forEach((c: any) => {
    if (!c?.studentId) return;
    contactsCountMap.set(c.studentId, (contactsCountMap.get(c.studentId) || 0) + 1);
  });

  const enrichedStudents = students.map((s) => ({
    ...s,
    justifications: justMap.get(s.id) || [],
    extraContactsCount: contactsCountMap.get(s.id) || 0,
  }));

  return (
    <AlunosClient
      initialStudents={enrichedStudents}
      classGroups={classGroups}
      isAdmin={ctx.isSchoolManager}
      isIntegrated={currentSchool.edition === "PILOTO_INTEGRADA"}
    />
  );
}
