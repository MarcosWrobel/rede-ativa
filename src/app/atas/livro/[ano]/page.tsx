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

  const minutes = await prisma.pedagogicalMinute.findMany({
    where: {
      schoolId: school.id,
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

  return <LivroAnualClient school={school} year={year} minutes={minutes} />;
}
