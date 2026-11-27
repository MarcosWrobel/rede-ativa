import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/rlsTenantContext";
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
    await withTenantContext(prisma, schoolId, async (tx) => {
      students =
        (await tx.student.findMany({
          where: {
            schoolId,
            active: true,
            classGroup: { schoolId },
          },
          include: {
            classGroup: true,
            _count: {
              select: {
                messageLogs: { where: { OR: [{ schoolId: null }, { schoolId }] } },
              },
            },
          },
          orderBy: [{ classGroup: { name: "asc" } }, { name: "asc" }],
        })) || [];
      classGroups =
        (await tx.classGroup.findMany({
          where: { schoolId },
          orderBy: { name: "asc" },
        })) || [];
      recentJustifications = await safeQueryList(() =>
        tx.absenceJustification.findMany({
          where: { student: { schoolId }, endDate: { gte: recentCutoff } },
          orderBy: { endDate: "desc" },
        })
      );
      allContacts = await safeQueryList(() =>
        tx.studentContact.findMany({
          where: { student: { schoolId } },
          select: { id: true, studentId: true, whatsappValid: true },
        })
      );
    });
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
