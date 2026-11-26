import { prisma } from "@/lib/prisma";
import { resolveAuthorizedPageContext } from "@/lib/pageAuth";
import AtasClient from "./AtasClient";

export const metadata = {
  title: "Livro de Atas Pedagógicas | Registro Escolar",
};

export default async function AtasPage({
  searchParams,
}: {
  searchParams?: Promise<{ studentId?: string; create?: string; category?: string }>;
}) {
  const ctx = await resolveAuthorizedPageContext();
  const isAdmin = ctx.isSchoolManager;
  const school = ctx.school;

  let sp: { studentId?: string; create?: string; category?: string } = {};
  try {
    if (searchParams) {
      sp = (await searchParams) || {};
    }
  } catch (e) {
    console.warn("[AtasPage] Erro ao ler searchParams:", e);
  }

  const currentYear = new Date().getFullYear();

  let formattedStudents: any[] = [];
  try {
    const students = await prisma.student.findMany({
      where: { schoolId: school.id, active: true },
      select: {
        id: true,
        name: true,
        cgm: true,
        email: true,
        phone: true,
        guardianName: true,
        classGroup: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    });
    formattedStudents = students.map((s) => ({
      id: s.id,
      name: s.name,
      cgm: s.cgm,
      email: s.email,
      phone: s.phone,
      guardianName: s.guardianName,
      classGroupName: s.classGroup?.name,
    }));
  } catch (err) {
    console.error("[AtasPage] Erro ao carregar alunos:", err);
  }

  return (
    <div className="space-y-6">
      <AtasClient
        school={school}
        currentYear={currentYear}
        availableStudents={formattedStudents}
        isAdmin={isAdmin}
        initialStudentId={sp.studentId}
        initialCreateOpen={sp.create === "true" || Boolean(sp.studentId)}
        initialCategory={sp.category}
      />
    </div>
  );
}
