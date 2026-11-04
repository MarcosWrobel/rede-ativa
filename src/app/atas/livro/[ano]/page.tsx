import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { getCurrentSchool } from "@/lib/currentSchool";
import LivroAnualClient from "./LivroAnualClient";

interface Props {
  params: Promise<{ ano: string }>;
}

export default async function LivroAnualPage({ params }: Props) {
  const { ano } = await params;
  const year = parseInt(ano, 10);
  if (isNaN(year)) notFound();

  const school = await getCurrentSchool();

  const isDefaultSchoolContext =
    school.id === "default-leopoldina" || school.inepCode === "41042730";

  const schoolFilter = isDefaultSchoolContext
    ? {
        OR: [
          { schoolId: school.id },
          ...(school.id !== "default-leopoldina" ? [{ schoolId: "default-leopoldina" }] : []),
        ],
      }
    : { schoolId: school.id };

  let minutes: any[] = [];
  try {
    minutes = await prisma.pedagogicalMinute.findMany({
      where: {
        ...schoolFilter,
        year,
        status: { in: ["FINALIZED", "VOIDED"] },
      },
      orderBy: { ataNumber: "asc" },
      include: {
        students: true,
        participants: true,
        addendums: { orderBy: { createdAt: "asc" } },
        actionItems: true,
      },
    });
  } catch (err) {
    console.error("[LivroAnualPage] Erro ao consultar atas do livro anual:", err);
  }

  return <LivroAnualClient school={school} year={year} minutes={minutes} />;
}
