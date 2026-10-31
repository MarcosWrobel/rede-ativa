import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import AtasClient from "./AtasClient";

export const metadata = {
  title: "Livro de Atas Pedagógicas | Registro Escolar",
};

export default async function AtasPage() {
  const authCheck = await requireAuth();
  if (!authCheck.ok) {
    redirect("/login");
  }
  const isAdmin = authCheck.role === "ADMIN";
  const school = await getCurrentSchool(authCheck.schoolId);

  const currentYear = new Date().getFullYear();

  let formattedStudents: any[] = [];
  try {
    const students = await prisma.student.findMany({
      where: { active: true },
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
      />
    </div>
  );
}
